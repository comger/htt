import time
from typing import Dict, Any, List
import networkx as nx
from src.data_ingestion import DataPoint, ts_cache
from src.graph_storage import LightGraphStorage
from src.schema_registry import SchemaRegistry

class T3DiagnosticEngine:
    """
    T3 机理审计与因果联动诊断引擎。
    基于图谱连线 (Edges) 进行空间溯源，结合时域积分 (Delta t) 寻找物理因果关系，
    从而定性传感器行为是 [传感器故障] 还是 [真理水情告警]。
    """
    def __init__(self, storage: LightGraphStorage, schema_registry: SchemaRegistry, add_alert_callback):
        self.storage = storage
        self.schema_registry = schema_registry
        # 用于将 T3 的诊断事件抛回主 Alert 流
        self.add_alert_callback = add_alert_callback

    def evaluate_t3(self, point: DataPoint, node_data: Dict[str, Any], algorithms: List[Dict[str, Any]]):
        """
        处理单点触发的 T3 评估。
        """
        for algo in algorithms:
            algo_id = algo.get("algo_id")
            if algo_id == "t3_scs_cn":
                self._eval_t3_scs_cn(point, node_data, algo.get("params", {}))
            elif algo_id == "t3_mass_balance":
                pass

    def _eval_t3_scs_cn(self, point: DataPoint, node_data: Dict[str, Any], params: Dict[str, Any]):
        """
        SCS-CN 因果对账逻辑。
        针对节点：通常是下游水位计或流量计。
        逻辑：
        1. 检查当前节点（水位计）是否发生了激增 (例如最近 1 小时上涨超过 threshold)。
        2. 若激增，沿图谱溯源（遍历 predecessors）寻找具有汇流关系的上游雨量计。
        3. 对雨量计在过去 Delta_t 时间内的数据求积分（总降雨量）。
        4. 综合判断：涨水且有雨 -> 真水情；涨水但无雨 -> 传感器故障。
        """
        threshold = params.get("rise_threshold_m", 0.5) # 水位激增判断阈值
        delta_t_hours = params.get("delay_hours", 2)    # 溯源时间窗
        delta_t_sec = delta_t_hours * 3600
        
        # 1. 检查下游自身是否发生激增
        past_points = ts_cache.get_points_in_window(point.node_id, point.timestamp, delta_t_sec)
        if not past_points:
            return

        min_past_val = min(p.value for p in past_points)
        rise = point.value - min_past_val
        
        if rise < threshold:
            return  # 没明显涨水，不需要机理核查

        # 2. 发生了激增，启动图谱溯源寻找上游雨量计
        upstream_rain_gauges = []
        for pred in self.storage.graph.predecessors(point.node_id):
            pred_data = self.storage.get_node(pred)
            if not pred_data: continue
            
            schema_id = pred_data.get("schema_id")
            if not schema_id: continue
            
            schema = self.schema_registry.node_schemas.get(schema_id)
            if schema and schema.get("category") == "Sensor" and "雨量" in schema.get("name", ""):
                upstream_rain_gauges.append(pred)

        if not upstream_rain_gauges:
            return  # 找不到上游雨量计，无法机理对账

        # 3. 计算上游累计降雨量
        total_rain = 0.0
        for rg_id in upstream_rain_gauges:
            total_rain += ts_cache.get_sum_in_window(rg_id, point.timestamp, delta_t_sec)

        # 4. 因果定性
        if total_rain > 10.0: # 经验值：降雨量大于10mm认定为降雨导致
            self.add_alert_callback(
                point.node_id, "T3", 
                f"[True Alert 真实告警] 水位激增 {rise:.2f}m，经图谱追溯，上游 {delta_t_hours}h 内累计降雨 {total_rain:.1f}mm，机理对账吻合！",
                point.value, "t3_scs_cn"
            )
        else:
            self.add_alert_callback(
                point.node_id, "T3", 
                f"[Sensor Fault 干扰/故障] 水位无端激增 {rise:.2f}m！经图谱追溯，上游 {delta_t_hours}h 内累计降雨仅 {total_rain:.1f}mm，严重违背物理因果机理！",
                point.value, "t3_scs_cn"
            )
