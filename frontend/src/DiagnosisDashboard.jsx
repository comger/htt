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
