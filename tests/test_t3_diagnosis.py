from fastapi.testclient import TestClient
import time
from src.main import app

client = TestClient(app)

def test_t3_scs_cn_diagnosis():
    # 1. 建立基础 Node Schemas
    client.post("/api/schemas/nodes", json={
        "id": "rain_sensor_schema",
        "name": "智能雨量计",
        "category": "Sensor",
        "attributes": [],
        "bound_algorithms": []
    })
    
    client.post("/api/schemas/nodes", json={
        "id": "wl_sensor_schema",
        "name": "下游水位计",
        "category": "Sensor",
        "attributes": [],
        "bound_algorithms": [
            {"algo_id": "t3_scs_cn", "params": {"rise_threshold_m": 1.0, "delay_hours": 2}}
        ]
    })
    
    # 2. 建立实例图谱拓扑
    client.post("/api/nodes", json={
        "id": "rg_1",
        "labels": ["Sensor"],
        "properties": {"schema_id": "rain_sensor_schema"}
    })
    
    client.post("/api/nodes", json={
        "id": "wl_1",
        "labels": ["Sensor"],
        "properties": {"schema_id": "wl_sensor_schema"}
    })
    
    # 建立连线（因果链路）：雨量计 ->(流入)-> 水位计
    client.post("/api/edges", json={
        "source": "rg_1",
        "target": "wl_1",
        "type": "flows_into",
        "properties": {}
    })
    
    # 3. 测试情景 A：真实的洪灾 (上游下大雨，下游水位激涨)
    t0 = time.time()
    
    # 先注入历史平稳数据 (防止没有 baseline)
    for i in range(3):
        client.post("/api/ingest", json={"node_id": "wl_1", "timestamp": t0 + i*3600, "value": 50.0})
        client.post("/api/ingest", json={"node_id": "rg_1", "timestamp": t0 + i*3600, "value": 0.0})
        
    # 上游狂下大雨 50mm
    client.post("/api/ingest", json={"node_id": "rg_1", "timestamp": t0 + 3.5*3600, "value": 50.0})
    
    # 下游水位暴涨 2 米 (阈值 1.0m)
    client.post("/api/ingest", json={"node_id": "wl_1", "timestamp": t0 + 4*3600, "value": 52.0})
    
    alerts = client.get("/api/alerts").json()["alerts"]
    assert len(alerts) > 0
    t3_alert = alerts[-1]
    assert t3_alert["level"] == "T3"
    assert "True Alert" in t3_alert["message"]  # 真实告警

    # 4. 测试情景 B：传感器故障/干扰 (上游无雨，下游水位无端暴涨)
    t1 = t0 + 100 * 3600 # 时间拉远
    
    # 平稳
    for i in range(3):
        client.post("/api/ingest", json={"node_id": "wl_1", "timestamp": t1 + i*3600, "value": 30.0})
        client.post("/api/ingest", json={"node_id": "rg_1", "timestamp": t1 + i*3600, "value": 0.0})
        
    # 此时上游毫无降雨，但下游水位突然暴涨 5 米
    client.post("/api/ingest", json={"node_id": "wl_1", "timestamp": t1 + 4*3600, "value": 35.0})
    
    alerts = client.get("/api/alerts").json()["alerts"]
    t3_alert_fake = alerts[-1]
    assert t3_alert_fake["level"] == "T3"
    assert "Sensor Fault" in t3_alert_fake["message"] # 识别为故障干扰

    print("✅ T3 Graph Causal Mechanism Diagnosis working perfectly!")
