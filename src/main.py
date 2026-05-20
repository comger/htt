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
from src.data_ingestion import DataPoint, ts_cache
from src.rule_engine import RuleEngine
from src.edge_inference import EdgeModelManager

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
rule_engine = RuleEngine(storage, schema_registry)
edge_model_manager = EdgeModelManager()

@app.post("/api/ingest")
def ingest_data(point: DataPoint):
    """
    接收实时传感器数据流。
    此接口会触发 T1 和 T2 算法引擎。
    """
    rule_engine.process_point(point)
    return {"status": "success"}

@app.post("/api/ingest/batch")
def ingest_batch(points: List[DataPoint]):
    """批量注入数据流"""
    for point in points:
        rule_engine.process_point(point)
    return {"status": "success", "processed": len(points)}

@app.post("/api/ingest/scenario")
def ingest_scenario(req: Dict[str, Any]):
    """
    注入预定义场景数据，用于演示 HTT 拦截效果。
    scenario_id: 'normal' | 't1_overflow' | 't2_rate_spike' | 't3_causal'
    node_id: 目标节点
    """
    import time as time_mod
    scenario_id = req.get("scenario_id")
    node_id = req.get("node_id")
    
    if not node_id:
        raise HTTPException(status_code=400, detail="node_id is required")
    node_data = storage.get_node(node_id)
    if not node_data:
        raise HTTPException(status_code=404, detail="Node not found")
    
    # 读取物理极限
    max_val = float(node_data.get("t1_range_max") or node_data.get("t1_max_height") or node_data.get("t1_max_flow") or 100.0)
    min_val = float(node_data.get("t1_range_min") or 0.0)
    normal_val = min_val + (max_val - min_val) * 0.4
    
    now = time_mod.time()
    points_to_inject = []
    results = []
    
    if scenario_id == "normal":
        # 注入 10 个正常范围内的读数（稳定值略有波动）
        import random, math
        for i in range(10):
            val = normal_val + math.sin(i * 0.8) * (max_val * 0.05)
            points_to_inject.append(DataPoint(node_id=node_id, timestamp=now - (10 - i) * 6, value=round(val, 2)))
        results.append(f"注入 10 个正常读数，范围 [{round(normal_val*0.9,1)}, {round(normal_val*1.1,1)}]")
    
    elif scenario_id == "t1_overflow":
        # 先注入 3 个正常值，再注入 3 个超限值，再注入 2 个回归正常
        for i in range(3):
            points_to_inject.append(DataPoint(node_id=node_id, timestamp=now - 40 + i*5, value=round(normal_val, 2)))
        for i in range(3):
            overflow = max_val * (1.15 + i * 0.1)
            points_to_inject.append(DataPoint(node_id=node_id, timestamp=now - 25 + i*5, value=round(overflow, 2)))
        for i in range(2):
            points_to_inject.append(DataPoint(node_id=node_id, timestamp=now - 10 + i*5, value=round(normal_val, 2)))
        results.append(f"T1 超限演示: 3次正常 → 3次超限(>{round(max_val,1)}) → 2次恢复")
    
    elif scenario_id == "t2_rate_spike":
        # 先平稳，然后短时间内急剧跳变（模拟传感器干扰或设备故障）
        baseline = normal_val
        points_to_inject.append(DataPoint(node_id=node_id, timestamp=now - 60, value=round(baseline, 2)))
        points_to_inject.append(DataPoint(node_id=node_id, timestamp=now - 50, value=round(baseline + max_val * 0.05, 2)))
        # 突变：60秒内变化了50%的量程
        points_to_inject.append(DataPoint(node_id=node_id, timestamp=now - 5, value=round(baseline + max_val * 0.55, 2)))
        points_to_inject.append(DataPoint(node_id=node_id, timestamp=now - 2, value=round(baseline, 2)))
        results.append(f"T2 突变演示: 60s内激增 {round(max_val*0.5,1)} (触发突变速率拦截)")
    
    elif scenario_id == "t3_causal":
        # 需要向多个相关节点注入数据以触发 T3 机理验证
        # 找出与该节点关联的下游节点
        downstream_nodes = list(storage.graph.successors(node_id))
        
        # 上游节点注入极高值（强降雨）
        points_to_inject.append(DataPoint(node_id=node_id, timestamp=now - 30, value=round(normal_val, 2)))
        points_to_inject.append(DataPoint(node_id=node_id, timestamp=now - 20, value=round(max_val * 0.85, 2)))
        points_to_inject.append(DataPoint(node_id=node_id, timestamp=now - 10, value=round(max_val * 0.90, 2)))
        
        # 下游节点保持"异常低值"（违背物理因果：上游暴雨，下游应该涨水，却未变化）
        for dn in downstream_nodes[:1]:
            dn_data = storage.get_node(dn)
            if dn_data:
                dn_max = float(dn_data.get("t1_range_max") or dn_data.get("t2_warning_level") or 10.0)
                dn_normal = dn_max * 0.2  # 保持极低值不涨
                for i in range(3):
                    points_to_inject.append(DataPoint(node_id=dn, timestamp=now - 25 + i*10, value=round(dn_normal, 2)))
        
        if downstream_nodes:
            results.append(f"T3 机理演示: 上游节点激增 → 下游节点({downstream_nodes[0]})异常平稳 → 因果逻辑矛盾")
        else:
            results.append(f"T3 演示: 上游节点高值注入（需图谱中有下游节点以触发因果校验）")
    else:
        raise HTTPException(status_code=400, detail=f"Unknown scenario_id: {scenario_id}")
    
    for p in points_to_inject:
        rule_engine.process_point(p)
    
    return {
        "status": "success", 
        "scenario_id": scenario_id,
        "injected_count": len(points_to_inject),
        "summary": results
    }

@app.get("/api/alerts")
def get_alerts(limit: int = 50):
    """获取系统最新的拦截告警"""
    return {"status": "success", "alerts": rule_engine.get_recent_alerts(limit)}

@app.get("/api/stats")
def get_stats():
    """获取全局治理效果统计"""
    total = rule_engine.total_processed_points
    intercepts = len(rule_engine.alerts)
    t1_count = sum(1 for a in rule_engine.alerts if a.level == "T1")
    t2_count = sum(1 for a in rule_engine.alerts if a.level == "T2")
    t3_count = sum(1 for a in rule_engine.alerts if a.level == "T3")
    
    health_score = 100
    if total > 0:
        health_score = max(0, 100 - (intercepts / total * 100))
        
    return {
        "status": "success",
        "stats": {
            "total_ingested": total,
            "total_intercepted": intercepts,
            "t1_intercepts": t1_count,
            "t2_intercepts": t2_count,
            "t3_intercepts": t3_count,
            "health_score": round(health_score, 1)
        }
    }

@app.get("/api/nodes/{node_id}/timeseries")
def get_node_timeseries(node_id: str):
    """获取节点近期合规数据流与被拦截的红叉点"""
    valid = ts_cache.get_recent(node_id, limit=50)
    valid_points = [{"timestamp": p.timestamp, "value": p.value} for p in valid]
    
    node_alerts = [a for a in rule_engine.alerts if a.node_id == node_id][-50:]
    intercepted_points = [{"timestamp": a.timestamp, "value": a.raw_value, "level": a.level, "message": a.message} for a in node_alerts]
    
    return {
        "status": "success",
        "valid_points": valid_points,
        "intercepted_points": intercepted_points
    }

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

@app.get("/api/export")
def export_edge_bundle():
    """导出用于边缘端推理的 JSON Bundle (Schemas + Graph)"""
    import datetime
    
    nodes = [{"id": n_id, "data": data} for n_id, data in storage.get_all_nodes().items()]
    edges = [{"source": u, "target": v, "data": data} for u, v, data in storage.graph.edges(data=True)]
    
    return {
        "version": "1.5",
        "timestamp": datetime.datetime.now().isoformat(),
        "schemas": {
            "node_schemas": schema_registry.get_all_node_schemas(),
            "edge_schemas": schema_registry.get_all_edge_schemas()
        },
        "graph": {
            "nodes": nodes,
            "edges": edges
        }
    }

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

@app.delete("/api/nodes/{node_id}")
def delete_node(node_id: str):
    storage.delete_node(node_id)
    return {"status": "success"}

@app.post("/api/edges")
def sync_edge(edge: EdgeModel):
    """从可视化画布同步新增连线"""
    storage.add_edge(edge.source, edge.target, edge.type, edge.properties)
    return {"status": "success"}

@app.delete("/api/edges/{source}/{target}")
def delete_edge(source: str, target: str):
    storage.delete_edge(source, target)
    return {"status": "success"}

class BulkSyncRequest(BaseModel):
    nodes: List[NodeModel]
    edges: List[EdgeModel]

@app.post("/api/graph/bulk")
def bulk_sync_graph(req: BulkSyncRequest):
    for n in req.nodes:
        storage.add_node(n.id, labels=n.labels, properties=n.properties)
    for e in req.edges:
        storage.add_edge(e.source, e.target, e.type, e.properties)
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

@app.get("/api/edge/interact")
def edge_interact():
    """
    边缘端 AI 获取最新图谱状态并输出操作指令。
    前端可轮询此接口，获取后执行指令。
    """
    graph_state = {
        "nodes": [{"id": n_id, "data": data} for n_id, data in storage.get_all_nodes().items()],
        "edges": [{"source": u, "target": v, "data": data} for u, v, data in storage.graph.edges(data=True)]
    }
    alerts = rule_engine.get_recent_alerts(limit=5)
    action = edge_model_manager.generate_action(graph_state, alerts)
    return {"status": "success", "action": action}

@app.post("/api/edge/correct")
def edge_correct(req: Dict[str, Any]):
    """
    执行大模型下发的纠偏指令。
    参数例：{"node_id": "n1", "param": "cn", "value": 85}
    """
    node_id = req.get("node_id")
    param = req.get("param")
    value = req.get("value")
    
    if not all([node_id, param, value is not None]):
        raise HTTPException(status_code=400, detail="Missing required parameters")
        
    # get_node returns a flat networkx attr dict (labels, plus all properties at top level)
    node_data = storage.get_node(node_id)
    if not node_data:
        raise HTTPException(status_code=404, detail="Node not found")
    
    # Extract labels and build updated properties dict
    labels = node_data.get("labels", [])
    properties = {k: v for k, v in node_data.items() if k != "labels"}
    properties[param] = value
    
    storage.add_node(node_id, labels, properties)
    
    return {"status": "success", "message": f"Corrected {param} of {node_id} to {value}"}
