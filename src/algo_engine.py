# src/algo_engine.py
from typing import Dict, Any

# 系统预置的可挂载算法算子 (算法库元数据)
# 实际运行态(Phase 4)时将在这里实现具体的 DataFrame 时序计算逻辑

AVAILABLE_ALGORITHMS = {
    # T1 算法
    "t1_physical_limit": {
        "id": "t1_physical_limit",
        "name": "T1: 物理极值拦截 (Static Limit)",
        "type": "T1",
        "description": "基于静态属性(如最大量程、设计坝高)直接拦截溢出数据。",
        "params": ["target_property"]
    },
    
    # T2 算法
    "t2_3sigma": {
        "id": "t2_3sigma",
        "name": "T2: 3-Sigma 动态异常检验 (3-Sigma Anomaly)",
        "type": "T2",
        "description": "调取过去 N 天时序数据，计算均值与标准差，拦截超过 3-sigma 范围的突变数据。",
        "params": ["window_days"]
    },
    "t2_seasonal_max": {
        "id": "t2_seasonal_max",
        "name": "T2: 历史同期极值比对 (Seasonal Max)",
        "type": "T2",
        "description": "调取数据库中往年同月/同期的极值进行对比，拦截超历史经验的数据。",
        "params": []
    },
    "t2_rate_of_change": {
        "id": "t2_rate_of_change",
        "name": "T2: 突变速率拦截 (Rate of Change)",
        "type": "T2",
        "description": "计算相邻两个时间片的一阶导数（变化率），拦截不符合自然规律的陡增陡降。",
        "params": ["max_delta_per_hour"]
    },
    
    # T3 算法
    "t3_scs_cn": {
        "id": "t3_scs_cn",
        "name": "T3: SCS-CN 产汇流机理对账 (SCS-CN Routing)",
        "type": "T3",
        "description": "基于 SCS-CN 与 IUH 算法，利用上游降雨量预测当前断面的水位/流量，进行因果交叉比对。",
        "params": ["upstream_node_id", "cn_value_property"]
    },
    "t3_mass_balance": {
        "id": "t3_mass_balance",
        "name": "T3: 质量守恒/水量平衡审计 (Mass Balance)",
        "type": "T3",
        "description": "水库入库流量 = 出库流量 + 蓄水变量。通过三者数据的相互制约关系清洗野值。",
        "params": ["inflow_nodes", "outflow_nodes"]
    }
}

def get_available_algorithms() -> Dict[str, Any]:
    return AVAILABLE_ALGORITHMS
