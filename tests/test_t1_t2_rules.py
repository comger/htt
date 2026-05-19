from fastapi.testclient import TestClient
import time
from src.main import app

client = TestClient(app)

def test_t1_t2_engines():
    # 1. 模拟插入一个带算法绑定的 Node Schema
    schema_res = client.post("/api/schemas/nodes", json={
        "id": "sensor_schema_v1",
        "name": "智能水位计",
        "category": "Sensor",
        "attributes": [
            {"name": "min_val", "type": "number", "default": 0, "description": "最小水位"},
            {"name": "max_val", "type": "number", "default": 100, "description": "最大水位"},
            {"name": "max_delta_per_hour", "type": "number", "default": 5, "description": "每小时最大变化率"}
        ],
        "bound_algorithms": [
            {"algo_id": "t1_physical_limit", "params": {}},
            {"algo_id": "t2_rate_of_change", "params": {}},
            {"algo_id": "t2_3sigma", "params": {}}
        ]
    })
    assert schema_res.status_code == 200

    # 2. 同步一个真实设备节点到图谱
    client.post("/api/nodes", json={
        "id": "wl_sensor_1",
        "labels": ["Sensor"],
        "properties": {
            "schema_id": "sensor_schema_v1",
            "name": "水库大坝水位计",
            "min_val": 0,
            "max_val": 100,
            "max_delta_per_hour": 10
        }
    })

    # 3. 注入正常流数据 (应当进入缓存区，无拦截)
    t0 = time.time()
    for i in range(10):
        res = client.post("/api/ingest", json={
            "node_id": "wl_sensor_1",
            "timestamp": t0 + i * 3600,  # 间隔 1 小时
            "value": 50 + i * 0.5  # 缓慢上涨 (0.5m/h)
        })
        assert res.status_code == 200

    alerts_res = client.get("/api/alerts")
    assert len(alerts_res.json()["alerts"]) == 0

    # 4. 测试 T1: 物理极限超越 (输入 120m，超 max_val 100)
    client.post("/api/ingest", json={
        "node_id": "wl_sensor_1",
        "timestamp": t0 + 10 * 3600,
        "value": 120 
    })
    
    alerts = client.get("/api/alerts").json()["alerts"]
    assert len(alerts) == 1
    assert alerts[0]["level"] == "T1"
    assert alerts[0]["algo_id"] == "t1_physical_limit"

    # 5. 测试 T2: 突变速率异常 (上一帧 54.5m，现在 65m，经过0.5小时，变化率 > 10m/h)
    client.post("/api/ingest", json={
        "node_id": "wl_sensor_1",
        "timestamp": t0 + 9.5 * 3600, # 往回倒一点测试
        "value": 65 
    })
    
    alerts = client.get("/api/alerts").json()["alerts"]
    assert len(alerts) == 2
    assert alerts[-1]["level"] == "T2"
    assert alerts[-1]["algo_id"] == "t2_rate_of_change"
    
    # 6. 测试 T2: 3-Sigma 离群 (均值约 52，标准差很小，输入一个极度偏离但又没超 T1/T2 Rate的)
    # 因为 Rate of change 是按时间算的，如果时间足够长，Rate 是合法的，但是它脱离了近期的均值圈。
    client.post("/api/ingest", json={
        "node_id": "wl_sensor_1",
        "timestamp": t0 + 100 * 3600, # 过很久
        "value": 90 
    })
    
    alerts = client.get("/api/alerts").json()["alerts"]
    assert len(alerts) == 3
    assert alerts[-1]["level"] == "T2"
    assert alerts[-1]["algo_id"] == "t2_3sigma"

    print("✅ All T1 and T2 audit rules passed successfully.")
