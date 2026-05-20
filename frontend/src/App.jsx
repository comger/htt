import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactFlow, { 
  MiniMap, Controls, Background, useNodesState, useEdgesState, addEdge,
  MarkerType, ReactFlowProvider, useReactFlow
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Database, Activity, Sparkles, Send, Settings, X, Mic, Loader2, Trash2, Library, Network, ShieldCheck, Box, Waypoints, Download, Play, AlertTriangle, TrendingUp, Filter, CheckCircle2, Bot, Zap, RotateCcw, ChevronRight } from 'lucide-react';
import axios from 'axios';
import dagre from 'dagre';
import { ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

let id = 1000;
const getId = () => `node_instance_${id++}`;

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  dagreGraph.setGraph({ rankdir: direction });
  nodes.forEach((node) => { dagreGraph.setNode(node.id, { width: 180, height: 60 }); });
  edges.forEach((edge) => { dagreGraph.setEdge(edge.source, edge.target); });
  dagre.layout(dagreGraph);
  return {
    nodes: nodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      node.targetPosition = direction === 'LR' ? 'left' : 'top';
      node.sourcePosition = direction === 'LR' ? 'right' : 'bottom';
      node.position = { x: nodeWithPosition.x - 90, y: nodeWithPosition.y - 30 };
      return node;
    }),
    edges
  };
};

function FlowCanvas({ schemas, edgeSchemas }) {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { screenToFlowPosition, fitView } = useReactFlow();
  
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);

  const fetchGraph = async () => {
    try {
      const res = await axios.get('/api/graph');
      const backendNodes = res.data.nodes.map(n => ({
        id: n.id,
        position: { x: 0, y: 0 },
        data: { label: n.data.name || n.id, ...n.data },
      }));
      const backendEdges = res.data.edges.map(e => ({
        id: `${e.source}-${e.target}`,
        source: e.source, target: e.target, label: e.data.type, animated: true, markerEnd: { type: MarkerType.ArrowClosed },
        data: e.data
      }));
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(backendNodes, backendEdges);
      setNodes([...layoutedNodes]); setEdges([...layoutedEdges]);
      setTimeout(() => fitView(), 100);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchGraph(); }, []);

  const onConnect = useCallback((params) => {
    const newEdgeData = { type: "关联", properties: {}, schema_id: "generic_link" };
    setEdges((eds) => addEdge({ ...params, animated: true, markerEnd: { type: MarkerType.ArrowClosed }, data: newEdgeData }, eds));
    
    axios.post('/api/edges', {
      source: params.source, target: params.target, 
      type: newEdgeData.type, properties: { ...newEdgeData.properties, schema_id: newEdgeData.schema_id }
    }).catch(console.error);
  }, [setEdges]);

  const handleAIBuild = async () => {
    if (!prompt.trim()) return;
    setIsLoading(true);
    try {
      const res = await axios.post('/api/ai/extract', { text: prompt });
      if (res.data.status === 'success') {
        const { nodes: aiNodes, edges: aiEdges } = res.data.extracted;
        const newNodes = aiNodes.map(n => ({
          id: n.id, position: { x: 0, y: 0 },
          data: { label: n.properties?.name || n.id, ...n.properties, _labels: n.labels },
          type: 'default'
        }));
        const newEdges = aiEdges.map(e => ({
          id: `${e.source}-${e.target}-${Date.now()}`, source: e.source, target: e.target, label: e.type,
          animated: true, markerEnd: { type: MarkerType.ArrowClosed },
          data: { type: e.type, properties: e.properties || {} }
        }));
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements([...nodes, ...newNodes], [...edges, ...newEdges]);
        setNodes([...layoutedNodes]); setEdges([...layoutedEdges]);
        
        // Sync bulk to backend
        axios.post('/api/graph/bulk', {
          nodes: newNodes.map(n => ({ id: n.id, labels: n.data._labels || ["Sensor"], properties: n.data })),
          edges: newEdges.map(e => ({ source: e.source, target: e.target, type: e.data.type, properties: e.data.properties }))
        }).catch(console.error);
        
        setTimeout(() => fitView(), 100);
        setPrompt("");
      } else { alert(res.data.message); }
    } catch (err) { alert("AI Parsing Error"); }
    setIsLoading(false);
  };

  const onDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const schemaId = e.dataTransfer.getData('application/reactflow_schema');
    if (!schemaId || !schemas[schemaId]) return;
    const schema = schemas[schemaId];
    
    const defaultProps = {};
    schema.attributes.forEach(attr => defaultProps[attr.name] = attr.default);

    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const newNode = {
      id: getId(), type: 'default', position,
      data: { label: `新建 ${schema.name}`, name: `新建 ${schema.name}`, schema_id: schema.id, _labels: [schema.category], ...defaultProps },
    };
    setNodes((nds) => nds.concat(newNode));
    
    axios.post('/api/nodes', {
      id: newNode.id, labels: newNode.data._labels, properties: newNode.data
    }).catch(console.error);
  }, [screenToFlowPosition, setNodes, schemas]);

  const onDragStart = (e, schemaId) => {
    e.dataTransfer.setData('application/reactflow_schema', schemaId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onNodeClick = (e, node) => { setSelectedEdge(null); setSelectedNode(node); };
  const onEdgeClick = (e, edge) => { setSelectedNode(null); setSelectedEdge(edge); };
  
  const onNodesDelete = useCallback((deletedNodes) => {
    deletedNodes.forEach(node => {
      axios.delete(`/api/nodes/${node.id}`).catch(console.error);
    });
  }, []);

  const onEdgesDelete = useCallback((deletedEdges) => {
    deletedEdges.forEach(edge => {
      axios.delete(`/api/edges/${edge.source}/${edge.target}`).catch(console.error);
    });
  }, []);

  const handleDeleteNode = () => {
    setNodes(nds => nds.filter(n => n.id !== selectedNode.id));
    setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
    axios.delete(`/api/nodes/${selectedNode.id}`).catch(console.error);
    setSelectedNode(null);
  };

  const handleSaveNodeProperties = () => {
    const cleanData = {};
    for (let k in selectedNode.data) {
      const v = selectedNode.data[k];
      if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) && !['name', 'label', 'id', 'schema_id', 'type'].includes(k)) cleanData[k] = Number(v);
      else cleanData[k] = v;
    }
    
    setNodes(nds => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...cleanData, label: cleanData.name || cleanData.label } } : n));
    axios.post('/api/nodes', {
      id: selectedNode.id, labels: cleanData._labels || ["Sensor"], properties: cleanData
    }).catch(console.error);
    setSelectedNode(null);
  };

  const handleSaveEdgeProperties = () => {
    const cleanProps = {};
    if (selectedEdge.data && selectedEdge.data.properties) {
      for (let k in selectedEdge.data.properties) {
        const v = selectedEdge.data.properties[k];
        if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) cleanProps[k] = Number(v);
        else cleanProps[k] = v;
      }
    }

    setEdges(eds => eds.map(e => e.id === selectedEdge.id ? { ...e, label: selectedEdge.data.type, data: { ...selectedEdge.data, properties: cleanProps } } : e));
    axios.post('/api/edges', {
      source: selectedEdge.source, target: selectedEdge.target, 
      type: selectedEdge.data.type,
      properties: { ...cleanProps, schema_id: selectedEdge.data.schema_id }
    }).catch(console.error);
    setSelectedEdge(null);
  };

  const applyEdgeSchema = (schemaId) => {
    const s = edgeSchemas[schemaId];
    if (!s) return;
    const defaultProps = {};
    s.attributes.forEach(attr => defaultProps[attr.name] = attr.default);
    setSelectedEdge(p => ({
      ...p, 
      data: { ...p.data, schema_id: schemaId, type: s.name, properties: defaultProps }
    }));
  };

  return (
    <div className="flex h-[calc(100vh-64px)] w-full text-slate-200">
      <aside className="w-64 bg-slate-900 border-r border-slate-800 p-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
        <div className="text-sm text-slate-400 font-medium">可用实体类 (拖拽至画布):</div>
        {Object.values(schemas).map(schema => (
          <div key={schema.id} className="p-3 border border-slate-700 bg-slate-800 rounded-lg cursor-grab hover:border-indigo-500 flex items-center gap-3 transition-colors"
               onDragStart={(e) => onDragStart(e, schema.id)} draggable>
            <Box className="w-4 h-4 text-emerald-400" />
            <div className="flex flex-col">
              <span className="text-sm font-bold">{schema.name}</span>
              <span className="text-xs text-slate-500">{schema.category}</span>
            </div>
          </div>
        ))}
      </aside>

      <main className="flex-grow h-full relative bg-slate-950" ref={reactFlowWrapper}>
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 w-full max-w-2xl">
          <div className={`bg-slate-800 border ${isRecording ? 'border-red-500' : 'border-slate-600'} shadow-2xl rounded-full p-2 flex items-center gap-3`}>
            <button onClick={() => {setIsRecording(!isRecording); if(!isRecording) setTimeout(()=>setPrompt("构建一个小流域山洪模型"), 1000);}} className={`p-2 rounded-full ${isRecording ? 'bg-red-500/20 animate-pulse' : 'hover:bg-slate-700'}`}>
              <Mic className={`w-5 h-5 ${isRecording ? 'text-red-400' : 'text-slate-400'}`} />
            </button>
            <input 
              type="text" className="flex-grow bg-transparent border-none outline-none text-slate-100 placeholder-slate-400 px-2 text-sm"
              placeholder="语音或文本描述您的业务场景..." value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAIBuild()}
              disabled={isLoading}
            />
            <button onClick={handleAIBuild} disabled={isLoading || !prompt} className="bg-indigo-600 hover:bg-indigo-700 p-2 rounded-full w-10 h-10 flex items-center justify-center">
              {isLoading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Sparkles className="w-5 h-5 text-white" />}
            </button>
          </div>
        </div>

        <ReactFlow
          nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick} onDrop={onDrop} onDragOver={onDragOver}
          onNodesDelete={onNodesDelete} onEdgesDelete={onEdgesDelete}
          fitView deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background color="#334155" gap={16} />
          <Controls className="bg-slate-800 fill-slate-200 border-slate-700" />
        </ReactFlow>
      </main>

      {selectedNode && (
        <aside className="absolute right-6 top-24 w-80 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-5 flex flex-col gap-4 z-20">
          <div className="flex justify-between items-center border-b border-slate-700 pb-2">
            <h2 className="font-bold text-slate-100 flex items-center gap-2"><Settings className="w-5 h-5 text-indigo-400"/>实体微调</h2>
            <button onClick={() => setSelectedNode(null)}><X className="w-5 h-5 text-slate-400" /></button>
          </div>
          
          <div className="flex flex-col gap-4 overflow-y-auto max-h-[60vh] pr-1 custom-scrollbar">
            {selectedNode.data.schema_id && schemas[selectedNode.data.schema_id] && (
               <div className="bg-slate-900/50 p-3 rounded border border-indigo-500/20">
                 <div className="text-xs text-indigo-400 font-bold mb-1">继承自 Schema:</div>
                 <div className="text-sm text-slate-300">{schemas[selectedNode.data.schema_id].name}</div>
                 <div className="mt-2 flex flex-col gap-1">
                   {schemas[selectedNode.data.schema_id].bound_algorithms?.map((algo, idx) => (
                     <div key={idx} className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-400/10 p-1 rounded">
                       <ShieldCheck className="w-3 h-3"/> {algo.algo_id}
                     </div>
                   ))}
                 </div>
               </div>
            )}

            {Object.keys(selectedNode.data).filter(k => !['label', '_labels', 'schema_id'].includes(k)).map(key => {
                const val = selectedNode.data[key];
                const attrSchema = schemas[selectedNode.data.schema_id]?.attributes?.find(a => a.name === key);
                const isNumber = attrSchema ? attrSchema.type === 'number' : (!isNaN(parseFloat(val)) && isFinite(val));
                
                return (
                  <div key={key}>
                    <label className="text-xs text-slate-400">{key}</label>
                    <input 
                      type={isNumber ? "number" : "text"} step="any" value={val ?? ''} 
                      onChange={(e) => setSelectedNode(p => ({...p, data: {...p.data, [key]: e.target.value}}))} 
                      className="mt-1 w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm text-slate-100" 
                    />
                  </div>
                );
            })}
          </div>
          <button onClick={handleSaveNodeProperties} className="bg-indigo-600 hover:bg-indigo-700 p-2.5 rounded-lg text-sm transition-colors">保存同步</button>
        </aside>
      )}

      {selectedEdge && (
        <aside className="absolute right-6 top-24 w-80 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-5 flex flex-col gap-4 z-20">
          <div className="flex justify-between items-center border-b border-slate-700 pb-2">
            <h2 className="font-bold text-slate-100 flex items-center gap-2"><Network className="w-5 h-5 text-indigo-400"/>关系类分配与微调</h2>
            <button onClick={() => setSelectedEdge(null)}><X className="w-5 h-5 text-slate-400" /></button>
          </div>
          
          <div className="flex flex-col gap-4 overflow-y-auto max-h-[60vh] pr-1 custom-scrollbar">
            
            <div className="bg-slate-900 border border-slate-700 p-3 rounded">
              <label className="text-xs text-indigo-400 font-bold block mb-2">选择关系类 (Edge Schema)</label>
              <select 
                className="w-full bg-slate-800 border border-slate-600 p-1.5 rounded text-sm text-slate-200"
                value={selectedEdge.data?.schema_id || ""}
                onChange={(e) => applyEdgeSchema(e.target.value)}
              >
                <option value="">-- 自定义 (无约束) --</option>
                {Object.values(edgeSchemas).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {selectedEdge.data?.schema_id && edgeSchemas[selectedEdge.data.schema_id] && (
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-xs text-slate-500 italic">{edgeSchemas[selectedEdge.data.schema_id].description}</p>
                  {edgeSchemas[selectedEdge.data.schema_id].spatial_predicate && edgeSchemas[selectedEdge.data.schema_id].spatial_predicate !== 'None' && (
                    <div className="flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-400/10 w-max px-2 py-1 rounded">
                      <span>DE-9IM: {edgeSchemas[selectedEdge.data.schema_id].spatial_predicate}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-slate-400">连接说明 (Type)</label>
              <input type="text" value={selectedEdge.data?.type || ''} onChange={(e) => setSelectedEdge(p => ({...p, data: {...p.data, type: e.target.value}}))} className="mt-1 w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm text-slate-100" />
            </div>

            <div className="bg-slate-900/50 p-3 rounded border border-slate-700 mt-2">
              <div className="flex justify-between items-center mb-2">
                <div className="text-xs text-indigo-400 font-bold">边参数 (拓扑与时滞):</div>
                <button 
                  onClick={() => {
                    const newKey = prompt("请输入新的边参数名称 (例如: weight)");
                    if(newKey) {
                      setSelectedEdge(p => ({...p, data: {...p.data, properties: {...(p.data?.properties||{}), [newKey]: 0}}}));
                    }
                  }} 
                  className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded"
                >+ 添加</button>
              </div>
              
              {(!selectedEdge.data?.properties || Object.keys(selectedEdge.data.properties).length === 0) && (
                <div className="text-xs text-slate-500 italic">暂无边参数</div>
              )}
              
              {selectedEdge.data?.properties && Object.keys(selectedEdge.data.properties).map(key => {
                  const val = selectedEdge.data.properties[key];
                  const attrSchema = edgeSchemas[selectedEdge.data?.schema_id]?.attributes?.find(a => a.name === key);
                  const isNumber = attrSchema ? attrSchema.type === 'number' : (!isNaN(parseFloat(val)) && isFinite(val));
                  
                  return (
                    <div key={key} className="mt-2 flex items-center gap-2">
                      <label className="text-xs text-slate-400 w-1/3 truncate">{key}</label>
                      <input 
                        type={isNumber ? "number" : "text"} step="any" value={val ?? ''} 
                        onChange={(e) => setSelectedEdge(p => ({...p, data: {...p.data, properties: {...p.data.properties, [key]: e.target.value}}}))} 
                        className="flex-1 bg-slate-800 border border-slate-700 rounded p-1 text-sm text-slate-100" 
                      />
                      <button onClick={() => {
                        const newProps = {...selectedEdge.data.properties}; delete newProps[key];
                        setSelectedEdge(p => ({...p, data: {...p.data, properties: newProps}}));
                      }} className="text-rose-400 p-1"><X className="w-3 h-3"/></button>
                    </div>
                  );
              })}
            </div>
          </div>
          <button onClick={handleSaveEdgeProperties} className="bg-indigo-600 hover:bg-indigo-700 p-2.5 rounded-lg text-sm transition-colors mt-2">保存关系映射</button>
        </aside>
      )}
    </div>
  );
}

function SchemaManager({ nodeSchemas, edgeSchemas, algorithms, refreshSchemas }) {
  const [activeSubTab, setActiveSubTab] = useState('nodes'); // 'nodes' or 'edges'
  const [editingSchema, setEditingSchema] = useState(null);

  const handleCreateNew = () => {
    setEditingSchema({
      id: `New_${Date.now()}`,
      name: "新类",
      category: activeSubTab === 'nodes' ? "Sensor" : undefined,
      description: activeSubTab === 'edges' ? "描述" : undefined,
      attributes: [],
      bound_algorithms: activeSubTab === 'nodes' ? [] : undefined
    });
  };

  const handleSave = async () => {
    try {
      const endpoint = activeSubTab === 'nodes' ? '/api/schemas/nodes' : '/api/schemas/edges';
      await axios.post(endpoint, editingSchema);
      refreshSchemas();
      setEditingSchema(null);
    } catch (err) {
      console.error(err);
      alert("保存失败");
    }
  };

  const addAttribute = () => setEditingSchema(s => ({...s, attributes: [...s.attributes, {name: 'new_attr', type: 'number', default: 0, description: ''}]}));
  const updateAttribute = (idx, key, val) => setEditingSchema(s => { const attrs = [...s.attributes]; attrs[idx] = {...attrs[idx], [key]: val}; return {...s, attributes: attrs}; });
  const removeAttribute = (idx) => setEditingSchema(s => ({...s, attributes: s.attributes.filter((_, i) => i !== idx)}));

  const currentList = activeSubTab === 'nodes' ? nodeSchemas : edgeSchemas;

  return (
    <div className="flex h-[calc(100vh-64px)] w-full text-slate-200 bg-slate-950 p-6 gap-6">
      <div className="w-1/3 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col">
        <div className="flex bg-slate-800 p-1 rounded-lg mb-4">
          <button onClick={() => {setActiveSubTab('nodes'); setEditingSchema(null);}} className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded text-sm transition-colors ${activeSubTab === 'nodes' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-300'}`}><Box className="w-4 h-4"/> 实体类 (Nodes)</button>
          <button onClick={() => {setActiveSubTab('edges'); setEditingSchema(null);}} className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded text-sm transition-colors ${activeSubTab === 'edges' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-300'}`}><Waypoints className="w-4 h-4"/> 关系类 (Edges)</button>
        </div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg flex items-center gap-2"><Library className="w-5 h-5 text-indigo-400"/> 注册字典</h2>
          <button onClick={handleCreateNew} className="bg-indigo-600 hover:bg-indigo-700 p-1.5 rounded text-sm font-medium">+ 新建类</button>
        </div>
        <div className="flex-grow overflow-y-auto custom-scrollbar">
          {Object.values(currentList).map(s => (
            <div key={s.id} onClick={() => setEditingSchema(JSON.parse(JSON.stringify(s)))} className={`mb-3 p-3 bg-slate-800 border rounded-lg cursor-pointer transition-colors ${editingSchema?.id === s.id ? 'border-indigo-500 shadow-lg' : 'border-slate-700 hover:border-slate-500'}`}>
              <h3 className="font-bold text-slate-100">{s.name} {s.category && <span className="text-xs bg-slate-700 px-2 py-1 rounded ml-2">{s.category}</span>}</h3>
              <div className="text-xs text-slate-400 mt-1">包含 {s.attributes.length} 个参数约束</div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="w-2/3 bg-slate-900 border border-slate-800 rounded-xl p-6 overflow-y-auto custom-scrollbar">
        {!editingSchema ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4">
            <Library className="w-16 h-16 opacity-20" />
            <p>请在左侧选择一个类，或者点击“新建类”开始扩展您的字典</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h2 className="text-xl font-bold text-indigo-400">编辑类: {editingSchema.name}</h2>
              <button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded text-sm font-bold shadow-lg transition-colors">
                保存并同步底层
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-xs text-slate-400 mb-1 block">类 ID (英文字符)</label><input className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-sm" value={editingSchema.id} onChange={e => setEditingSchema({...editingSchema, id: e.target.value})} /></div>
              <div><label className="text-xs text-slate-400 mb-1 block">显示名称 (Name)</label><input className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-sm" value={editingSchema.name} onChange={e => setEditingSchema({...editingSchema, name: e.target.value})} /></div>
              {activeSubTab === 'nodes' && (
                <div><label className="text-xs text-slate-400 mb-1 block">分类 (Category)</label>
                  <select className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-sm text-white" value={editingSchema.category} onChange={e => setEditingSchema({...editingSchema, category: e.target.value})}>
                    <option value="Sensor">Sensor (传感器)</option><option value="Facility">Facility (物理设施)</option><option value="Environment">Environment (自然环境)</option>
                  </select>
                </div>
              )}
              {activeSubTab === 'edges' && (
                <div className="col-span-2 grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">关系说明 (Description)</label>
                    <input className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-sm" value={editingSchema.description || ''} onChange={e => setEditingSchema({...editingSchema, description: e.target.value})} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">空间拓扑谓词 (DE-9IM)</label>
                    <select className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-sm text-indigo-300 font-bold" value={editingSchema.spatial_predicate || 'None'} onChange={e => setEditingSchema({...editingSchema, spatial_predicate: e.target.value})}>
                      <option value="None">无空间关系 (None)</option>
                      <option value="Contains">包含 (Contains ⊃)</option>
                      <option value="Within">被包含 (Within ⊂)</option>
                      <option value="Touches">接触/相接 (Touches)</option>
                      <option value="Crosses">跨越 (Crosses ⨯)</option>
                      <option value="Intersects">相交 (Intersects ∩)</option>
                      <option value="Overlaps">重叠 (Overlaps)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-slate-800/50 border border-slate-800 p-4 rounded-xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-200">静态物理/拓扑属性 (Attributes)</h3>
                <button onClick={addAttribute} className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded transition-colors">+ 添加属性</button>
              </div>
              <div className="flex flex-col gap-3">
                {editingSchema.attributes.length === 0 && <span className="text-xs text-slate-500">暂无属性</span>}
                {editingSchema.attributes.map((attr, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input placeholder="属性Key (如 weight)" className="flex-1 bg-slate-900 border border-slate-700 p-1.5 rounded text-xs" value={attr.name} onChange={e => updateAttribute(idx, 'name', e.target.value)} />
                    <input placeholder="默认值" className="w-24 bg-slate-900 border border-slate-700 p-1.5 rounded text-xs" value={attr.default} onChange={e => updateAttribute(idx, 'default', e.target.value)} />
                    <input placeholder="中文说明" className="flex-1 bg-slate-900 border border-slate-700 p-1.5 rounded text-xs" value={attr.description} onChange={e => updateAttribute(idx, 'description', e.target.value)} />
                    <button onClick={() => removeAttribute(idx)} className="text-rose-400 hover:text-rose-300 p-1"><X className="w-4 h-4"/></button>
                  </div>
                ))}
              </div>
            </div>

            {activeSubTab === 'nodes' && (
              <div className="bg-slate-800/50 border border-slate-800 p-4 rounded-xl">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-slate-200 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400"/> 挂载 T1/T2/T3 算法引擎</h3>
                  <div className="flex items-center gap-2">
                    <select id="algoSelect" className="bg-slate-900 border border-slate-700 p-1 rounded text-xs text-slate-300">
                      <option value="">-- 选择可用算子 --</option>
                      {Object.keys(algorithms).map(k => <option key={k} value={k}>{algorithms[k].name}</option>)}
                    </select>
                    <button onClick={() => {
                        const algo_id = document.getElementById('algoSelect').value;
                        if(algo_id) setEditingSchema(s => ({...s, bound_algorithms: [...s.bound_algorithms, {algo_id, params: {}}]}));
                    }} className="text-xs bg-emerald-600 hover:bg-emerald-500 px-2 py-1 rounded transition-colors text-white">挂载</button>
                  </div>
                </div>
                
                <div className="flex flex-col gap-3">
                  {editingSchema.bound_algorithms?.map((algo, idx) => (
                    <div key={idx} className="bg-slate-900 border border-slate-700 p-3 rounded flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-bold text-emerald-400">{algorithms[algo.algo_id]?.name || algo.algo_id}</span>
                        <button onClick={() => setEditingSchema(s => ({...s, bound_algorithms: s.bound_algorithms.filter((_, i) => i !== idx)}))} className="text-rose-400 text-xs">卸载算子</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DiagnosisDashboard() {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { fitView } = useReactFlow();

  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState({ total_ingested: 0, total_intercepted: 0, health_score: 100 });
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [timeSeriesData, setTimeSeriesData] = useState([]);
  const [inspectedNode, setInspectedNode] = useState(null);

  // Scenario simulator
  const SCENARIOS = [
    { id: 'normal',        label: '✅ 正常数据流',   color: 'emerald', badge: 'NORMAL', desc: '注入 10 个在物理限界内正常波动的读数，验证数据畅通通过 T1/T2 校验。' },
    { id: 't1_overflow',   label: '🚨 T1 物理超限',  color: 'rose',    badge: 'T1',     desc: '注入超越 t1_range_max 的读数，观察 T1 引擎立即拦截。' },
    { id: 't2_rate_spike', label: '⚡ T2 突变速率',  color: 'amber',   badge: 'T2',     desc: '极短时间窗大幅跳变，模拟传感器干扰或设备突发故障。' },
    { id: 't3_causal',     label: '🔬 T3 因果机理',  color: 'purple',  badge: 'T3',     desc: '上游高值+下游不动，违背物理因果逻辑，触发 T3 机理拦截。' },
  ];
  const [selectedScenario, setSelectedScenario] = useState('t1_overflow');
  const [scenarioNodeId, setScenarioNodeId] = useState('');
  const [scenarioRunning, setScenarioRunning] = useState(false);
  const [scenarioResult, setScenarioResult] = useState(null);

  const fetchGraphAndAlerts = async () => {
    try {
      const [graphRes, alertsRes, statsRes] = await Promise.all([
        axios.get('/api/graph'), axios.get('/api/alerts'), axios.get('/api/stats')
      ]);
      const currentAlerts = alertsRes.data.alerts || [];
      setAlerts(currentAlerts);
      if (statsRes.data.stats) setStats(statsRes.data.stats);
      const alertNodeIds = new Set(currentAlerts.map(a => a.node_id));
      const backendNodes = graphRes.data.nodes.map(n => ({
        id: n.id, position: { x: 0, y: 0 },
        data: { label: n.data.name || n.id, ...n.data },
        style: alertNodeIds.has(n.id)
          ? { border: '2px solid #ef4444', backgroundColor: '#7f1d1d', color: '#f87171', boxShadow: '0 0 20px rgba(239,68,68,0.5)' }
          : { border: '1px solid #10b981', backgroundColor: '#064e3b', color: '#34d399' }
      }));
      const backendEdges = graphRes.data.edges.map(e => ({
        id: `${e.source}-${e.target}`, source: e.source, target: e.target,
        label: e.data.type, animated: true, markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#475569' }
      }));
      const { nodes: ln, edges: le } = getLayoutedElements(backendNodes, backendEdges);
      setNodes([...ln]); setEdges([...le]);
    } catch (err) { console.error(err); }
  };

  const fetchNodeTimeSeries = async (nId) => {
    try {
      const res = await axios.get(`/api/nodes/${nId}/timeseries`);
      const { valid_points, intercepted_points } = res.data;
      const combined = [];
      valid_points.forEach(p => combined.push({ timestamp: p.timestamp, time: new Date(p.timestamp * 1000).toLocaleTimeString(), valid_val: p.value }));
      intercepted_points.forEach(p => combined.push({ timestamp: p.timestamp, time: new Date(p.timestamp * 1000).toLocaleTimeString(), intercept_val: p.value, reason: p.message, level: p.level }));
      combined.sort((a, b) => a.timestamp - b.timestamp);
      setTimeSeriesData(combined);
    } catch(e) { console.error(e); }
  };

  useEffect(() => {
    fetchGraphAndAlerts();
    setTimeout(() => fitView(), 200);
    const interval = setInterval(() => {
      fetchGraphAndAlerts();
      if (selectedNodeId) fetchNodeTimeSeries(selectedNodeId);
    }, 2000);
    return () => clearInterval(interval);
  }, [selectedNodeId]);

  const handleNodeClick = (e, node) => {
    setSelectedNodeId(node.id);
    fetchNodeTimeSeries(node.id);
    setInspectedNode(node);
  };

  const runScenario = async (scenId, nId) => {
    if (!nId) return;
    setScenarioRunning(true); setScenarioResult(null);
    try {
      const res = await axios.post('/api/ingest/scenario', { scenario_id: scenId, node_id: nId });
      setScenarioResult({ ok: true, data: res.data });
      setSelectedNodeId(nId); fetchNodeTimeSeries(nId); fetchGraphAndAlerts();
    } catch(e) { setScenarioResult({ ok: false, msg: e.response?.data?.detail || e.message }); }
    setScenarioRunning(false);
  };

  const scenarioCfg = SCENARIOS.find(s => s.id === selectedScenario);
  const SKIP_KEYS = ['label', 'name', '_labels', 'labels', 'schema_id'];
  const t1t2Keys = inspectedNode ? Object.keys(inspectedNode.data).filter(k => k.startsWith('t1_') || k.startsWith('t2_')) : [];
  const otherKeys = inspectedNode ? Object.keys(inspectedNode.data).filter(k => !k.startsWith('t1_') && !k.startsWith('t2_') && !SKIP_KEYS.includes(k)) : [];

  return (
    <div className="flex h-[calc(100vh-64px)] w-full text-slate-200">

      {/* LEFT SIDEBAR */}
      <aside className="w-96 bg-slate-900 border-r border-slate-800 flex flex-col z-20 shadow-2xl overflow-hidden">

        {/* Health Score */}
        <div className="p-4 border-b border-slate-800 bg-slate-800/40 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-slate-100 flex items-center gap-2 text-sm"><Activity className="w-4 h-4 text-indigo-400"/>全局健康度</h2>
            <span className={`text-2xl font-black ${stats.health_score > 90 ? 'text-emerald-400' : stats.health_score > 70 ? 'text-amber-400' : 'text-rose-500'}`}>{stats.health_score}%</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-1.5 mb-3">
            <div className={`h-1.5 rounded-full transition-all duration-700 ${stats.health_score > 90 ? 'bg-emerald-400' : stats.health_score > 70 ? 'bg-amber-400' : 'bg-rose-500'}`} style={{width: `${stats.health_score}%`}}/>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-slate-900 rounded p-1.5 border border-slate-800"><div className="text-slate-500">摄入</div><div className="font-bold text-slate-300">{stats.total_ingested}</div></div>
            <div className="bg-slate-900 rounded p-1.5 border border-slate-800"><div className="text-slate-500">拦截</div><div className="font-bold text-rose-400">{stats.total_intercepted}</div></div>
            <div className="bg-slate-900 rounded p-1.5 border border-slate-800"><div className="text-slate-500">T3</div><div className="font-bold text-purple-400">{stats.t3_intercepts ?? 0}</div></div>
          </div>
        </div>

        {/* Scenario Simulator */}
        <div className="p-4 border-b border-slate-800 bg-slate-800/20 shrink-0">
          <h2 className="font-bold text-slate-100 flex items-center gap-2 text-sm mb-3"><Sparkles className="w-4 h-4 text-amber-400"/>HTT 场景模拟器</h2>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            {SCENARIOS.map(s => (
              <button key={s.id} onClick={() => setSelectedScenario(s.id)}
                className={`text-left p-2 rounded-lg border text-xs font-medium transition-all ${selectedScenario === s.id
                  ? s.color === 'emerald' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                  : s.color === 'rose'    ? 'border-rose-500 bg-rose-500/10 text-rose-300'
                  : s.color === 'amber'   ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                  :                         'border-purple-500 bg-purple-500/10 text-purple-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-500'}`}>
                {s.label}
              </button>
            ))}
          </div>
          {scenarioCfg && <div className="text-[11px] text-slate-400 bg-slate-900/60 rounded p-2 mb-3 leading-relaxed border border-slate-800">{scenarioCfg.desc}</div>}
          <select className="w-full bg-slate-950 border border-slate-700 p-1.5 rounded text-xs text-slate-300 mb-2" value={scenarioNodeId} onChange={e => setScenarioNodeId(e.target.value)}>
            <option value="">-- 选择目标节点 --</option>
            {nodes.map(n => <option key={n.id} value={n.id}>{n.data.label} ({n.id})</option>)}
          </select>
          <button onClick={() => runScenario(selectedScenario, scenarioNodeId)} disabled={!scenarioNodeId || scenarioRunning}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-sm font-bold transition-colors">
            {scenarioRunning ? <Loader2 className="w-4 h-4 animate-spin"/> : <Play className="w-4 h-4"/>}
            {scenarioRunning ? '注入中...' : '执行场景'}
          </button>
          {scenarioResult && (
            <div className={`mt-2 text-xs p-2 rounded border ${scenarioResult.ok ? 'bg-emerald-950/40 border-emerald-700 text-emerald-300' : 'bg-rose-950/40 border-rose-700 text-rose-300'}`}>
              {scenarioResult.ok ? `✅ 已注入 ${scenarioResult.data.injected_count} 条 — ${scenarioResult.data.summary?.[0]}` : `❌ ${scenarioResult.msg}`}
            </div>
          )}
        </div>

        {/* Alert Feed */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-2">
          <h2 className="font-bold text-slate-100 flex items-center gap-2 text-sm mb-1 shrink-0"><AlertTriangle className="w-4 h-4 text-rose-500"/>实时拦截告警</h2>
          {alerts.length === 0 && <div className="text-slate-500 text-xs italic text-center mt-8">系统运行平稳，无拦截事件</div>}
          {alerts.slice().reverse().map((alert, idx) => (
            <div key={idx} className={`p-2.5 rounded border flex flex-col gap-1 ${alert.level === 'T3' ? 'bg-rose-950/40 border-rose-500/50' : alert.level === 'T2' ? 'bg-amber-950/40 border-amber-500/50' : 'bg-orange-950/40 border-orange-500/50'}`}>
              <div className="flex justify-between items-center">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${alert.level === 'T3' ? 'bg-rose-500 text-white' : alert.level === 'T2' ? 'bg-amber-500 text-black' : 'bg-orange-500 text-white'}`}>{alert.level} · {alert.algo_id}</span>
                <span className="text-[10px] text-slate-500">{new Date(alert.timestamp * 1000).toLocaleTimeString()}</span>
              </div>
              <div className="text-xs font-bold text-slate-200">{alert.node_id}</div>
              <div className={`text-[11px] leading-tight ${alert.level === 'T3' ? 'text-rose-300' : 'text-amber-300'}`}>{alert.message}</div>
            </div>
          ))}
        </div>
      </aside>

      {/* MAIN CANVAS */}
      <main className="flex-grow h-full relative bg-slate-950" ref={reactFlowWrapper}>
        <div className="absolute top-4 right-4 z-10 bg-slate-900/80 p-3 rounded-lg border border-slate-700 text-xs text-slate-400 flex flex-col gap-2 backdrop-blur">
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"/>正常运行</div>
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]"/>告警节点</div>
          <div className="text-[10px] text-slate-600 border-t border-slate-700 pt-1 mt-0.5">点击节点查看属性</div>
        </div>
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          nodesDraggable={false} nodesConnectable={false} elementsSelectable={true}
          onNodeClick={handleNodeClick} fitView>
          <Background color="#1e293b" gap={16} />
          <Controls className="bg-slate-800 fill-slate-200 border-slate-700" />
        </ReactFlow>

        {/* NODE INSPECTOR */}
        {inspectedNode && (
          <div className="absolute top-16 right-4 w-72 bg-slate-900/97 backdrop-blur border border-slate-700 rounded-2xl shadow-2xl flex flex-col z-30 max-h-[calc(100%-5rem)] overflow-hidden">
            <div className="flex justify-between items-center p-3 border-b border-slate-800 shrink-0">
              <div>
                <div className="font-bold text-slate-100 text-sm flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-indigo-400"/>{inspectedNode.data.label || inspectedNode.id}</div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">{inspectedNode.id}</div>
              </div>
              <button onClick={() => setInspectedNode(null)} className="text-slate-500 hover:text-slate-300 p-1"><X className="w-4 h-4"/></button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 flex flex-col gap-3">
              {/* Labels */}
              <div>
                <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">类型标签</div>
                <div className="flex flex-wrap gap-1">
                  {(inspectedNode.data._labels || inspectedNode.data.labels || []).map(l => (
                    <span key={l} className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">{l}</span>
                  ))}
                </div>
              </div>
              {/* T1/T2 limit params */}
              {t1t2Keys.length > 0 && (
                <div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">HTT 限界参数</div>
                  <div className="flex flex-col gap-1">
                    {t1t2Keys.map(k => (
                      <div key={k} className={`flex justify-between items-center rounded px-2 py-1 text-xs ${k.startsWith('t1_') ? 'bg-rose-950/50 border border-rose-800/50' : 'bg-amber-950/50 border border-amber-800/50'}`}>
                        <span className={`font-mono text-[10px] ${k.startsWith('t1_') ? 'text-rose-400' : 'text-amber-400'}`}>{k}</span>
                        <span className="font-bold text-slate-200">{String(inspectedNode.data[k])}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Physical properties */}
              {otherKeys.length > 0 && (
                <div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">物理参数</div>
                  <div className="flex flex-col gap-1">
                    {otherKeys.map(k => (
                      <div key={k} className="flex justify-between items-center rounded px-2 py-1 text-xs bg-slate-800 border border-slate-700">
                        <span className="font-mono text-slate-400 text-[10px]">{k}</span>
                        <span className="text-slate-200 text-right max-w-[130px] truncate">{String(inspectedNode.data[k])}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Quick scenario buttons */}
              <div className="border-t border-slate-800 pt-2">
                <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">快速场景注入</div>
                <div className="grid grid-cols-2 gap-1">
                  {SCENARIOS.map(s => (
                    <button key={s.id} disabled={scenarioRunning}
                      onClick={() => runScenario(s.id, inspectedNode.id)}
                      className={`text-[10px] font-bold py-1.5 rounded border transition-colors disabled:opacity-40 ${
                        s.color === 'emerald' ? 'border-emerald-700 text-emerald-400 hover:bg-emerald-500/10'
                        : s.color === 'rose'  ? 'border-rose-700 text-rose-400 hover:bg-rose-500/10'
                        : s.color === 'amber' ? 'border-amber-700 text-amber-400 hover:bg-amber-500/10'
                        :                       'border-purple-700 text-purple-400 hover:bg-purple-500/10'}`}>
                      {scenarioRunning ? '...' : s.badge}
                    </button>
                  ))}
                </div>
                {scenarioResult && (
                  <div className={`mt-1.5 text-[10px] p-1.5 rounded ${scenarioResult.ok ? 'bg-emerald-950/40 text-emerald-300' : 'bg-rose-950/40 text-rose-300'}`}>
                    {scenarioResult.ok ? `✅ 注入 ${scenarioResult.data.injected_count} 条` : `❌ ${scenarioResult.msg}`}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TIME SERIES CHART */}
        {selectedNodeId && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[660px] h-56 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-2xl shadow-2xl p-4 flex flex-col z-20">
            <div className="flex justify-between items-center mb-2 shrink-0">
              <h3 className="font-bold text-slate-200 flex items-center gap-2 text-sm"><TrendingUp className="w-4 h-4 text-indigo-400"/>时序剖析: <span className="font-mono text-indigo-300 text-xs">{selectedNodeId}</span></h3>
              <button onClick={() => { setSelectedNodeId(null); setInspectedNode(null); }} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4"/></button>
            </div>
            <div className="flex-1 text-xs">
              {timeSeriesData.length === 0
                ? <div className="flex h-full items-center justify-center text-slate-500 text-xs">该节点暂无时序数据，请先执行场景注入</div>
                : <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={timeSeriesData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="time" stroke="#64748b" tick={{fontSize: 9}} />
                      <YAxis stroke="#64748b" tick={{fontSize: 9}} domain={['auto', 'auto']} />
                      <RechartsTooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} itemStyle={{ color: '#cbd5e1' }}
                        formatter={(value, name, props) => {
                          if (name === 'intercept_val') return [<span className="text-rose-400 font-bold">{value} — {props.payload.reason}</span>, '🚫 拦截'];
                          return [value, '✅ 合法'];
                        }}
                      />
                      <Line type="monotone" dataKey="valid_val" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981', stroke: 'none' }} isAnimationActive={false} />
                      <Scatter dataKey="intercept_val" fill="#ef4444" shape="cross" isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
              }
            </div>
          </div>
        )}
      </main>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Edge AI Copilot Component
// ─────────────────────────────────────────────────────────────────────────────
function EdgeAICopilot({ onAutoClick }) {
  const [isRunning, setIsRunning] = useState(false);
  const [actionLog, setActionLog] = useState([]);
  const [lastAction, setLastAction] = useState(null);
  const [correctionStatus, setCorrectionStatus] = useState(null);
  const intervalRef = useRef(null);

  const addLog = (action, status = 'info') => {
    const entry = { id: Date.now(), time: new Date().toLocaleTimeString(), action, status };
    setActionLog(prev => [entry, ...prev].slice(0, 30));
  };

  const executeAction = async (action) => {
    if (!action || action.action === 'none') return;
    setLastAction(action);
    if (action.action === 'click') {
      addLog(`🖱️ 自主点击节点: ${action.node_id} — ${action.reason}`, 'warning');
      if (onAutoClick) onAutoClick(action.node_id);
    } else if (action.action === 'correct_param') {
      addLog(`⚙️ 发起纠偏: ${action.node_id}.${action.param} → ${action.value}`, 'warning');
      setCorrectionStatus('applying');
      try {
        await axios.post('/api/edge/correct', { node_id: action.node_id, param: action.param, value: action.value });
        addLog(`✅ 纠偏成功: ${action.node_id}.${action.param} → ${action.value} | ${action.reason}`, 'success');
        setCorrectionStatus('done');
        if (onAutoClick) onAutoClick(action.node_id);
      } catch (e) {
        addLog(`❌ 纠偏失败: ${e.message}`, 'error');
        setCorrectionStatus('error');
      }
      setTimeout(() => setCorrectionStatus(null), 3000);
    }
  };

  const poll = async () => {
    try {
      const res = await axios.get('/api/edge/interact');
      const action = res.data?.action;
      if (action && action.action !== 'none') {
        await executeAction(action);
      } else {
        addLog('💤 图谱平稳，端侧 AI 待机中...', 'info');
      }
    } catch (e) {
      addLog(`⚠️ 端侧 AI 轮询失败: ${e.message}`, 'error');
    }
  };

  useEffect(() => {
    if (isRunning) {
      addLog('🚀 端侧 AI Copilot 启动，开始自主监控...', 'info');
      poll();
      intervalRef.current = setInterval(poll, 5000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        addLog('⏹ 端侧 AI Copilot 已停止。', 'info');
      }
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRunning]);

  const statusColor = { info: 'text-slate-400', success: 'text-emerald-400', warning: 'text-amber-400', error: 'text-rose-400' };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] w-full bg-slate-950 text-slate-200 p-6 gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-3 rounded-2xl ${isRunning ? 'bg-indigo-500/20 border border-indigo-500/50' : 'bg-slate-800 border border-slate-700'}`}>
            <Bot className={`w-7 h-7 ${isRunning ? 'text-indigo-400 animate-pulse' : 'text-slate-500'}`} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-100">端侧 AI Copilot</h2>
            <p className="text-sm text-slate-500">基于本地边缘模型的自主诊断与参数纠偏代理</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={poll} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-slate-300 transition-colors">
            <RotateCcw className="w-4 h-4" /> 立即触发
          </button>
          <button
            onClick={() => setIsRunning(r => !r)}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all ${
              isRunning
                ? 'bg-rose-600/20 border border-rose-500/50 text-rose-400 hover:bg-rose-600/30'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
            }`}
          >
            <Zap className={`w-4 h-4 ${isRunning ? 'animate-pulse' : ''}`} />
            {isRunning ? '停止 Copilot' : '启动 Copilot'}
          </button>
        </div>
      </div>

      {correctionStatus && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${
          correctionStatus === 'applying' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse' :
          correctionStatus === 'done'     ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                                           'bg-rose-500/10 border-rose-500/30 text-rose-400'
        }`}>
          {correctionStatus === 'applying' && <Loader2 className="w-4 h-4 animate-spin" />}
          {correctionStatus === 'done'     && <CheckCircle2 className="w-4 h-4" />}
          {correctionStatus === 'applying' && '正在应用纠偏指令...'}
          {correctionStatus === 'done'     && '参数纠偏完成，已同步至图谱节点。'}
          {correctionStatus === 'error'    && '纠偏失败，请检查控制台日志。'}
        </div>
      )}

      <div className="flex flex-1 gap-6 min-h-0">
        <div className="w-80 shrink-0 flex flex-col gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">最新 AI 指令</h3>
            {!lastAction || lastAction.action === 'none' ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-600 gap-2">
                <Bot className="w-10 h-10 opacity-30" />
                <span className="text-sm">等待图谱事件...</span>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold w-fit ${
                  lastAction.action === 'correct_param' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}>
                  {lastAction.action === 'correct_param' ? <Zap className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  {lastAction.action === 'correct_param' ? '参数纠偏' : '节点巡查'}
                </div>
                <div className="text-sm">
                  <span className="text-slate-500">目标节点: </span>
                  <span className="font-mono text-indigo-300">{lastAction.node_id}</span>
                </div>
                {lastAction.action === 'correct_param' && (
                  <div className="bg-slate-800 rounded-lg p-3 text-xs flex flex-col gap-1">
                    <div className="flex justify-between"><span className="text-slate-500">参数</span><span className="font-mono text-amber-300">{lastAction.param}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">纠偏值</span><span className="font-mono text-emerald-300 font-bold">{lastAction.value}</span></div>
                  </div>
                )}
                <p className="text-xs text-slate-500 italic">{lastAction.reason}</p>
              </div>
            )}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">模型状态</h3>
            <div className="flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
              <span className={isRunning ? 'text-emerald-400' : 'text-slate-500'}>{isRunning ? '在线 — 每 5s 轮询' : '离线'}</span>
            </div>
            <div className="text-xs text-slate-600 mt-1 font-mono">Mode: Mock (no GGUF model)</div>
            <div className="text-xs text-slate-600 mt-1">放入 .gguf 模型即可切换至真实推理</div>
          </div>
        </div>

        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">自主操作日志</h3>
            <button onClick={() => setActionLog([])} className="text-xs text-slate-600 hover:text-slate-400">清空</button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-1.5 font-mono text-xs">
            {actionLog.length === 0 && <div className="text-slate-600 text-center mt-10">日志为空，启动 Copilot 后在此实时显示操作记录。</div>}
            {actionLog.map(entry => (
              <div key={entry.id} className="flex items-start gap-3 leading-relaxed">
                <span className="text-slate-600 shrink-0 tabular-nums">{entry.time}</span>
                <span className={statusColor[entry.status]}>{entry.action}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('canvas');
  const [nodeSchemas, setNodeSchemas] = useState({});
  const [edgeSchemas, setEdgeSchemas] = useState({});
  const [algorithms, setAlgorithms] = useState({});

  const fetchSchemas = () => {
    axios.get('/api/schemas').then(res => {
      setNodeSchemas(res.data.node_schemas);
      setEdgeSchemas(res.data.edge_schemas);
    });
  };

  useEffect(() => {
    fetchSchemas();
    axios.get('/api/algorithms').then(res => setAlgorithms(res.data.algorithms));
  }, []);

  const handleExport = async () => {
    try {
      const res = await axios.get('/api/export');
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(res.data, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href",     dataStr);
      downloadAnchorNode.setAttribute("download", `htt_edge_bundle_${new Date().getTime()}.json`);
      document.body.appendChild(downloadAnchorNode); // required for firefox
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    } catch (error) {
      console.error("Export failed", error);
      alert("导出失败，请检查网络或控制台");
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 font-sans">
      <header className="h-16 border-b border-slate-800 bg-slate-900 flex items-center px-6 justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Database className="w-7 h-7 text-indigo-500" />
          <h1 className="font-bold text-xl text-slate-100 tracking-wide">HTT 物理本体引擎</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex bg-slate-800 p-1 rounded-lg">
            <button onClick={() => setActiveTab('canvas')} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'canvas' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>
              <Network className="w-4 h-4" /> 实例拓扑画板
            </button>
            <button onClick={() => setActiveTab('schema')} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'schema' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>
              <Library className="w-4 h-4" /> 本体定义字典 (Schemas)
            </button>
            <button onClick={() => setActiveTab('diagnosis')} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'diagnosis' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>
              <Activity className="w-4 h-4" /> 诊断与治理大屏
            </button>
            <button onClick={() => setActiveTab('edge')} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'edge' ? 'bg-indigo-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>
              <Bot className="w-4 h-4" /> 端侧 AI Copilot
            </button>
          </div>
          <button onClick={handleExport} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/40 rounded text-sm font-bold transition-colors">
            <Download className="w-4 h-4" /> 导出端侧包
          </button>
        </div>
      </header>

      {activeTab === 'canvas' && <ReactFlowProvider><FlowCanvas schemas={nodeSchemas} edgeSchemas={edgeSchemas} /></ReactFlowProvider>}
      {activeTab === 'schema' && <SchemaManager nodeSchemas={nodeSchemas} edgeSchemas={edgeSchemas} algorithms={algorithms} refreshSchemas={fetchSchemas} />}
      {activeTab === 'diagnosis' && <ReactFlowProvider><DiagnosisDashboard /></ReactFlowProvider>}
      {activeTab === 'edge' && <EdgeAICopilot />}
    </div>
  );
}
