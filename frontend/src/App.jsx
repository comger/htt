import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactFlow, { 
  MiniMap, Controls, Background, useNodesState, useEdgesState, addEdge,
  MarkerType, ReactFlowProvider, useReactFlow
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Database, Activity, Sparkles, Send, Settings, X, Mic, Loader2, Trash2, Library, Network, ShieldCheck, Box, Waypoints } from 'lucide-react';
import axios from 'axios';
import dagre from 'dagre';

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

  const onConnect = useCallback((params) => setEdges((eds) => addEdge({ ...params, animated: true, markerEnd: { type: MarkerType.ArrowClosed }, data: { type: "关联", properties: {}, schema_id: "generic_link" } }, eds)), [setEdges]);

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
  }, [screenToFlowPosition, setNodes, schemas]);

  const onDragStart = (e, schemaId) => {
    e.dataTransfer.setData('application/reactflow_schema', schemaId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onNodeClick = (e, node) => { setSelectedEdge(null); setSelectedNode(node); };
  const onEdgeClick = (e, edge) => { setSelectedNode(null); setSelectedEdge(edge); };
  
  const handleDeleteNode = () => {
    setNodes(nds => nds.filter(n => n.id !== selectedNode.id));
    setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
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
      data: { type: selectedEdge.data.type, properties: cleanProps, schema_id: selectedEdge.data.schema_id }
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
                <p className="text-xs text-slate-500 mt-2 italic">{edgeSchemas[selectedEdge.data.schema_id].description}</p>
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
                <div className="col-span-2"><label className="text-xs text-slate-400 mb-1 block">关系说明 (Description)</label>
                  <input className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-sm" value={editingSchema.description || ''} onChange={e => setEditingSchema({...editingSchema, description: e.target.value})} />
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

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 font-sans">
      <header className="h-16 border-b border-slate-800 bg-slate-900 flex items-center px-6 justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Database className="w-7 h-7 text-indigo-500" />
          <h1 className="font-bold text-xl text-slate-100 tracking-wide">HTT 物理本体引擎</h1>
        </div>
        <div className="flex bg-slate-800 p-1 rounded-lg">
          <button onClick={() => setActiveTab('canvas')} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'canvas' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>
            <Network className="w-4 h-4" /> 实例拓扑画板
          </button>
          <button onClick={() => setActiveTab('schema')} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'schema' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>
            <Library className="w-4 h-4" /> 本体定义字典 (Schemas)
          </button>
        </div>
      </header>

      {activeTab === 'canvas' ? (
        <ReactFlowProvider><FlowCanvas schemas={nodeSchemas} edgeSchemas={edgeSchemas} /></ReactFlowProvider>
      ) : (
        <SchemaManager nodeSchemas={nodeSchemas} edgeSchemas={edgeSchemas} algorithms={algorithms} refreshSchemas={fetchSchemas} />
      )}
    </div>
  );
}
