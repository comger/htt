import os
import pytest
import time
import tracemalloc
from src.graph_storage import LightGraphStorage

TEST_DB_PATH = "data/test_htt_graph.db"

@pytest.fixture(autouse=True)
def setup_and_teardown():
    # Setup
    if not os.path.exists("data"):
        os.makedirs("data")
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)
    
    yield
    
    # Teardown
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)

def test_graph_storage_crud_and_memory():
    # Start tracking memory
    tracemalloc.start()
    start_time = time.time()

    storage = LightGraphStorage(db_path=TEST_DB_PATH)
    
    # 插入 1000 个节点
    for i in range(1000):
        storage.add_node(f"sensor_{i}", labels=["Sensor"], properties={"type": "water_level", "max_limit": 100.0})
    
    # 插入 999 条关联边 (线性拓扑模拟)
    for i in range(999):
        storage.add_edge(f"sensor_{i}", f"sensor_{i+1}", edge_type="upstream_of", properties={"distance": 10.5})

    end_time = time.time()
    
    # Measure memory
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    # 断言数量
    assert len(storage.get_all_nodes()) == 1000
    assert len(storage.graph.edges) == 999

    # 断言数据准确性
    node_data = storage.get_node("sensor_500")
    assert node_data is not None
    assert node_data["max_limit"] == 100.0
    assert node_data["labels"] == ["Sensor"]

    edge_data = storage.get_edge("sensor_10", "sensor_11")
    assert edge_data is not None
    assert edge_data["type"] == "upstream_of"

    # 断言持久化 (重新加载)
    new_storage = LightGraphStorage(db_path=TEST_DB_PATH)
    assert len(new_storage.get_all_nodes()) == 1000
    assert len(new_storage.graph.edges) == 999
    
    # 打印内存和耗时报告
    print(f"\n--- Performance Report ---")
    print(f"Time to insert 1000 nodes & 999 edges: {end_time - start_time:.4f} seconds")
    print(f"Peak memory usage: {peak / 10**6:.4f} MB")
    
    # 边缘端要求极低内存开销，通常 1000 节点不应超过 10MB 峰值内存
    assert peak / 10**6 < 10.0 
