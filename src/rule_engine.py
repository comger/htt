import time
import statistics
from typing import Dict, Any, List
from src.data_ingestion import DataPoint, ts_cache
from src.graph_storage import LightGraphStorage
from src.schema_registry import SchemaRegistry
from src.t3_engine import T3DiagnosticEngine

class AlertEvent:
    def __init__(self, node_id: str, level: str, message: str, raw_value: float, algo_id: str):
        self.node_id = node_id
        self.level = level  # "T1", "T2", "T3"
        self.message = message
        self.raw_value = raw_value
        self.algo_id = algo_id
        self.timestamp = time.time()
        
    def to_dict(self):
        return {
            "node_id": self.node_id,
            "level": self.level,
            "message": self.message,
            "raw_value": self.raw_value,
            "algo_id": self.algo_id,
            "timestamp": self.timestamp
        }

class RuleEngine:
    """
    负责执行 T1/T2 审计规则。
    """
    def __init__(self, storage: LightGraphStorage, schema_registry: SchemaRegistry):
        self.storage = storage
        self.schema_registry = schema_registry
        self.alerts: List[AlertEvent] = []
        self.t3_engine = T3DiagnosticEngine(self.storage, self.schema_registry, self._trigger_alert)
        self.total_processed_points = 0

    def get_recent_alerts(self, limit=50):
        return [a.to_dict() for a in self.alerts[-limit:]]

    def process_point(self, point: DataPoint):
        """
        处理单个实时数据流节点，按序执行 T1、T2 校验。
        若通过校验，则将数据加入缓存，供后续 T3 使用。
        """
        self.total_processed_points += 1
        node_data = self.storage.get_node(point.node_id)
        if not node_data:
            return  # 节点不存在，忽略

        schema_id = node_data.get("schema_id")
        
        # 如果没有显式绑定 schema_id，尝试从 labels 中推断
        if not schema_id:
            labels = node_data.get("labels", [])
            for label in labels:
                if label in self.schema_registry.node_schemas:
                    schema_id = label
                    break

        if not schema_id:
            # 没有绑定 schema，直接入库
            ts_cache.push(point)
            return

        schema = self.schema_registry.node_schemas.get(schema_id)
        if not schema:
            ts_cache.push(point)
            return

        # 遍历挂载的算子
        algorithms = schema.get("bound_algorithms", [])
        
        # 执行 T1 检查
        for algo in algorithms:
            algo_id = algo.get("algo_id")
            if algo_id == "t1_physical_limit":
                if not self._check_t1_physical_limit(point, node_data, algo.get("params", {})):
                    return # 拦截，不入缓存
                
        # 执行 T2 检查
        for algo in algorithms:
            algo_id = algo.get("algo_id")
            if algo_id == "t2_rate_of_change":
                if not self._check_t2_rate_of_change(point, node_data, algo.get("params", {})):
                    return
            elif algo_id == "t2_seasonal_max":
                pass # TODO: 需要历史库支持
            elif algo_id == "t2_3sigma":
                if not self._check_t2_3sigma(point):
                    return
                    
        # 校验通过，存入时序缓存区
        ts_cache.push(point)

        # 启动 T3 机理评估
        self.t3_engine.evaluate_t3(point, node_data, algorithms)

    def _check_t1_physical_limit(self, point: DataPoint, node_data: Dict[str, Any], algo_params: Dict[str, Any]) -> bool:
        """T1: 物理极限校验"""
        target_prop = algo_params.get("target_property")
        min_val = float('-inf')
        max_val = float('inf')
        
        try:
            if target_prop and target_prop in node_data:
                val = float(node_data[target_prop])
                if 'min' in target_prop.lower():
                    min_val = val
                else:
                    max_val = val
            else:
                if "min_val" in node_data or "min_val" in algo_params:
                    min_val = float(node_data.get("min_val", algo_params.get("min_val", float('-inf'))))
                if "max_val" in node_data or "max_val" in algo_params:
                    max_val = float(node_data.get("max_val", algo_params.get("max_val", float('inf'))))
        except (ValueError, TypeError):
            pass
        
        if point.value < min_val or point.value > max_val:
            self._trigger_alert(
                point.node_id, "T1", 
                f"数值 {point.value} 超出物理极限区间 [{min_val}, {max_val}] (依据: {target_prop or 'min/max_val'})", 
                point.value, "t1_physical_limit"
            )
            return False
        return True

    def _check_t2_rate_of_change(self, point: DataPoint, node_data: Dict[str, Any], algo_params: Dict[str, Any]) -> bool:
        """T2: 突变速率拦截"""
        raw_max_delta = node_data.get("max_delta_per_hour", algo_params.get("max_delta_per_hour"))
        if raw_max_delta is None:
            return True
            
        try:
            max_delta = float(raw_max_delta)
        except (ValueError, TypeError):
            return True
            
        last_point = ts_cache.get_last(point.node_id)
        if not last_point:
            return True # 没有历史数据
            
        time_diff = (point.timestamp - last_point.timestamp) / 3600.0 # 小时
        if time_diff <= 0:
            return True
            
        rate = abs(point.value - last_point.value) / time_diff
        if rate > max_delta:
            self._trigger_alert(
                point.node_id, "T2",
                f"数据突变速率过快: {rate:.2f}/h，超过阈值 {max_delta}/h",
                point.value, "t2_rate_of_change"
            )
            return False
        return True
        
    def _check_t2_3sigma(self, point: DataPoint) -> bool:
        """T2: 3-Sigma 离群检测"""
        recent = ts_cache.get_recent(point.node_id, limit=20)
        if len(recent) < 5:
            return True # 样本不足
            
        values = [p.value for p in recent]
        mean = statistics.mean(values)
        stdev = statistics.stdev(values) if len(values) > 1 else 0
        
        if stdev == 0:
            return True
            
        if abs(point.value - mean) > 3 * stdev:
            self._trigger_alert(
                point.node_id, "T2",
                f"3-Sigma 异常: 数值 {point.value} 偏离均值 {mean:.2f} 超过 3 倍标准差 ({stdev:.2f})",
                point.value, "t2_3sigma"
            )
            return False
        return True

    def _trigger_alert(self, node_id, level, msg, val, algo_id):
        alert = AlertEvent(node_id, level, msg, val, algo_id)
        self.alerts.append(alert)
        print(f"[{level} ALERT] {node_id}: {msg}")
