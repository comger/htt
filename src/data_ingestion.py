import time
import collections
from typing import Dict, List, Any, Optional
from pydantic import BaseModel

class DataPoint(BaseModel):
    node_id: str
    timestamp: float
    value: float
    metadata: Dict[str, Any] = {}

class TimeSeriesCache:
    """
    轻量级内存时序缓存区。
    按 node_id 缓存最近 N 个数据点，供 T2 算法（突变速率、3-Sigma等）进行滑动窗口分析。
    """
    def __init__(self, window_size: int = 100):
        self.window_size = window_size
        # node_id -> deque of DataPoint
        self.cache: Dict[str, collections.deque] = collections.defaultdict(
            lambda: collections.deque(maxlen=self.window_size)
        )

    def push(self, point: DataPoint):
        self.cache[point.node_id].append(point)

    def get_recent(self, node_id: str, limit: int = None) -> List[DataPoint]:
        """获取某节点最近的数据（按时间先后顺序，最新在最后）"""
        if node_id not in self.cache:
            return []
        data = list(self.cache[node_id])
        if limit and limit > 0:
            return data[-limit:]
        return data

    def get_last(self, node_id: str) -> Optional[DataPoint]:
        if node_id in self.cache and len(self.cache[node_id]) > 0:
            return self.cache[node_id][-1]
        return None

    def get_points_in_window(self, node_id: str, current_time: float, delta_t_seconds: float) -> List[DataPoint]:
        """获取距当前时间 delta_t_seconds 内的所有数据点"""
        if node_id not in self.cache:
            return []
        
        valid_points = []
        # cache is deque, older items first
        for point in reversed(self.cache[node_id]):
            if current_time - point.timestamp <= delta_t_seconds:
                valid_points.insert(0, point)
            else:
                break
        return valid_points

    def get_sum_in_window(self, node_id: str, current_time: float, delta_t_seconds: float) -> float:
        """对距当前时间 delta_t_seconds 内的所有数据点的值求和（时域积分近似）"""
        points = self.get_points_in_window(node_id, current_time, delta_t_seconds)
        return sum(p.value for p in points)

    def clear(self):
        self.cache.clear()

# 全局单例
ts_cache = TimeSeriesCache(window_size=100)
