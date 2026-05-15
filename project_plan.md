# HTT (Hydro-Triple-Trust) 需求设计与开发规划

根据 HTT 的核心设计以及“轻量级、云边协同”的原则，我们将系统开发划分为 5 个迭代版本（Milestones）。每个小版本均包含明确的目标、功能拆解，以及可在端侧设备（或模拟测试车）上独立执行的验证测试程序。

## 技术栈决策与架构说明

基于项目对轻量级、可视化和 AI 深度集成的需求，本项目采用以下技术栈约束：
1. **核心后端与图谱逻辑**：**Python 3.10+**。使用 `FastAPI` 提供轻量级 Web 服务；图谱引擎采用 `NetworkX`（内存管理）结合 `SQLite`（持久化）；内置 `llama-cpp-python` 或 `onnxruntime` 支持端侧 AI。
2. **前端与可视化交互界面**：**React + Vite + Tailwind CSS**。提供两个核心可视化模块：
   - **引导式本体构建面板**：大模型对话驱动的节点拓扑拖拽与属性配置界面。
   - **通用治理与诊断大屏**：由底层本体结构（传感器拓扑）自动驱动生成的监控界面，支持异常节点高亮，并内置与本地端侧小模型的对话交互组件（支持模型自主触发点击动作）。

## AI Agent Skills 使用约束
在实际编码与构建阶段，AI 智能体需强制遵循以下技能（Skill）调用约束：
1. **前端交互与 UI 开发**：强制引入并基于 `ui-ux-pro-max` 与 `frontend-design` 进行开发。确保交付的 React/Tailwind 组件具备顶级数字孪生大屏科技感（如深色模式、流畅动效），严禁输出粗糙凑合的原型界面。
2. **模型通信与工具链**：云边端模型与后端的指令交互强制采用 `mcp-builder` 标准。通过 FastMCP (Python) 将底层图谱增删改查、规则触发器封装为标准 Tools，供模型调用以实现大屏的自主点击与诊断。
3. **自动化验证**：结合 `webapp-testing` 编写 E2E 测试脚本，确保大屏交互与诊断流在边缘测试环境跑通。

---

## 阶段规划 (Phased Milestones) & 任务清单

### Phase 1: 基础底座与轻量级图谱管理模块 (v0.1)
- **目标**：实现适合边缘端运行的极轻量级图谱数据存储与管理引擎，满足低内存开销。
- **任务清单**：
  - [ ] Initialize Python backend environment and project structure.
  - [ ] Implement `sqlite` + `networkx` lightweight graph storage engine.
  - [ ] Create CRUD API for ontology nodes and edges.
  - [ ] Write and run `tests/test_graph_storage.py` to verify memory constraints and functionality.
- **测试验证**：
  - `tests/test_graph_storage.py`：在限制内存环境（模拟边缘环境）下，插入 1000 个设备节点及其关联关系，执行查询与更新操作。断言其功能正确性并输出内存/耗时监控报告。

### Phase 2: 云边协同 AI 与引导式可视化建模 (v0.2)
- **目标**：实现开发态下，通过云端大模型 API 辅助提取属性，生成轻量级物理本体（H-Ontology）。
- **任务清单**：
  - [ ] Setup frontend React + Vite environment.
  - [ ] Setup AI API integration layer (OpenAI/DeepSeek compatible) in backend.
  - [ ] Implement backend API for AI-guided ontology extraction from text.
  - [ ] Implement React visual interface for AI-guided ontology construction.
  - [ ] Write and run `tests/test_ai_modeling.py`.
- **测试验证**：
  - `tests/test_ai_modeling.py`：读取预设的测试文本，调用 AI 接口进行实体识别，断言返回的图谱结构和物理极限属性被准确抽取并持久化。

### Phase 3: T1 & T2 审计规则引擎 (v0.3)
- **目标**：实现单点物理硬限界（T1）和时序数理筛（T2）的数据清洗。
- **任务清单**：
  - [ ] Implement data ingestion component (mock sensor data streaming).
  - [ ] Implement T1 Physical Limit engine.
  - [ ] Implement T2 Time Series Statistical Filter engine (sliding window, 3-sigma).
  - [ ] Write and run `tests/test_t1_t2_rules.py`.
- **测试验证**：
  - `tests/test_t1_t2_rules.py`：注入混合了“超越野值”和“高频噪声”的模拟数据流，断言系统能够精准触发 T1 和 T2 的拦截规则并输出预警日志。

### Phase 4: T3 机理审计与时域自适应诊断 (v0.4)
- **目标**：实现多源数据的因果机理逻辑验证（T3），结合时域因子（$\Delta t$）定性事件。
- **任务清单**：
  - [ ] Implement temporal accumulator ($\Delta t$).
  - [ ] Implement T3 causal mechanism logic based on multi-source data.
  - [ ] Implement diagnostic event dispatcher (interference, failure, true alert).
  - [ ] Write and run `tests/test_t3_diagnosis.py`.
- **测试验证**：
  - `tests/test_t3_diagnosis.py`：构建不同情景模拟流（隐蔽故障与真实险情），验证系统是否能在 $\Delta t$ 时间后分别准确输出定性结果。

### Phase 5: 本地端侧 AI 推理与大屏智能交互 (v0.5)
- **目标**：在边缘设备运行时，使用本地小模型（如 Gamma 4 量化版）进行诊断、参数纠偏，并通过治理大屏实现端侧智能交互。
- **任务清单**：
  - [ ] Integrate local edge model using `llama-cpp-python`.
  - [ ] Implement real-time parameter correction feedback loop.
  - [ ] Write and run `tests/test_edge_inference.py`.
  - [ ] Build Universal Governance & Diagnosis Dashboard in React (driven by ontology).
  - [ ] Implement native local model interaction and autonomous UI click support.
- **测试验证**：
  - `tests/test_edge_inference.py`：脱机状态下加载量化的端侧模型，断言模型能成功推理自适应参数，并能触发 UI 层面的自主操作逻辑。
