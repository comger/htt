import os
import json
from google import genai
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, List
from dotenv import load_dotenv
load_dotenv()

from src.graph_storage import LightGraphStorage, NodeModel, EdgeModel
from src.templates import DEFAULT_TEMPLATES
from src.algo_engine import get_available_algorithms
from src.schema_registry import SchemaRegistry

app = FastAPI(title="HTT Ontology Backend")

# 允许跨域请求 (为了本地开发)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化引擎
storage = LightGraphStorage()
schema_registry = SchemaRegistry()

@app.get("/api/algorithms")
def get_algorithms():
    """获取所有预置诊断算子"""
    return {"status": "success", "algorithms": get_available_algorithms()}

@app.get("/api/schemas")
def get_schemas():
    """获取所有已定义的 Node 和 Edge Schemas"""
    return {
        "status": "success", 
        "node_schemas": schema_registry.get_all_node_schemas(),
        "edge_schemas": schema_registry.get_all_edge_schemas()
    }

@app.post("/api/schemas/nodes")
def update_node_schema(schema_data: Dict[str, Any]):
    """新增或更新 Node Schema 定义"""
    schema = schema_registry.upsert_node_schema(schema_data)
    return {"status": "success", "schema": schema}

@app.post("/api/schemas/edges")
def update_edge_schema(schema_data: Dict[str, Any]):
    """新增或更新 Edge Schema 定义"""
    schema = schema_registry.upsert_edge_schema(schema_data)
    return {"status": "success", "schema": schema}

@app.get("/api/graph")
def get_graph():
    """获取所有节点和边的拓扑数据，供前端 React Flow 渲染"""
    nodes = [{"id": n_id, "data": data} for n_id, data in storage.get_all_nodes().items()]
    edges = [{"source": u, "target": v, "data": data} for u, v, data in storage.graph.edges(data=True)]
    return {"nodes": nodes, "edges": edges}

@app.post("/api/nodes")
def sync_node(node: NodeModel):
    """从可视化画布同步新增/更新节点"""
    storage.add_node(node.id, labels=node.labels, properties=node.properties)
    return {"status": "success"}

@app.post("/api/edges")
def sync_edge(edge: EdgeModel):
    """从可视化画布同步新增连线"""
    storage.add_edge(edge.source, edge.target, edge.type, edge.properties)
    return {"status": "success"}

@app.get("/api/templates")
def get_templates():
    """获取所有内置的业务场景模板"""
    return {"status": "success", "templates": DEFAULT_TEMPLATES}

# 智能大模型提取接口
class TextExtractionRequest(BaseModel):
    text: str

@app.post("/api/ai/extract")
def extract_ontology(req: TextExtractionRequest):
    """
    接收自然语言文本，调用 Gemini API 提取本体结构。
    """
    text = req.text
    
    # 尝试匹配内置模板关键字
    text_lower = text.lower()
    if "山洪" in text_lower or "流域" in text_lower:
        return {"status": "success", "extracted": DEFAULT_TEMPLATES["watershed_flood"]["graph"]}
    elif "水库" in text_lower or "大坝" in text_lower:
        return {"status": "success", "extracted": DEFAULT_TEMPLATES["reservoir_flood"]["graph"]}
    elif "闸门" in text_lower:
        return {"status": "success", "extracted": DEFAULT_TEMPLATES["gate_dispatch"]["graph"]}
    elif "边坡" in text_lower or "地质" in text_lower:
        return {"status": "success", "extracted": DEFAULT_TEMPLATES["geo_slope"]["graph"]}
        
    for key, tpl in DEFAULT_TEMPLATES.items():
        if tpl["name"] in text or key in text:
            return {"status": "success", "extracted": tpl["graph"]}
            
    # 调用大模型 (使用本机环境配置的 GEMINI_API_KEY)
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return {"status": "error", "message": "未配置 GEMINI_API_KEY，且未命中本地模板"}
        
    try:
        client = genai.Client(api_key=api_key)
        prompt = f'''
        你是一个图谱构建助手。请从以下文本中提取设备节点和关系，并严格返回合法的JSON格式（包含 nodes 和 edges 数组）：
        文本：{text}
        JSON格式示例：
        {{
            "nodes": [ {{"id": "node_1", "labels": ["Sensor"], "properties": {{"name": "水位计", "x": 100, "y": 100}} }} ],
            "edges": [ {{"source": "node_1", "target": "node_2", "type": "upstream_of", "properties": {{}} }} ]
        }}
        仅返回 JSON，不要返回任何多余字符。
        '''
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )
        
        # 清理可能存在的 markdown code blocks
        raw_text = response.text.replace("```json", "").replace("```", "").strip()
        extracted = json.loads(raw_text)
        return {"status": "success", "extracted": extracted}
        
    except Exception as e:
        return {"status": "error", "message": f"大模型解析失败: {str(e)}"}
