import pytest
from fastapi.testclient import TestClient
from src.main import app
from src.rule_engine import AlertEvent

client = TestClient(app)

def test_edge_interact_no_alerts():
    """When there are no alerts, edge AI should return 'none' action."""
    from src.main import storage, rule_engine
    storage.graph.clear()
    rule_engine.alerts.clear()
    
    res = client.get("/api/edge/interact")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["action"]["action"] == "none"

def test_edge_interact_t1_alert_returns_click():
    """When T1/T2 alert exists, edge AI should return 'click' action."""
    from src.main import storage, rule_engine
    storage.graph.clear()
    rule_engine.alerts.clear()
    
    storage.add_node("sensor_01", ["Sensor"], {"cn": 70})
    rule_engine.alerts.append(AlertEvent("sensor_01", "T1", "超物理极限", 999.0, "t1_physical_limit"))
    
    res = client.get("/api/edge/interact")
    assert res.status_code == 200
    action = res.json()["action"]
    assert action["action"] == "click"
    assert action["node_id"] == "sensor_01"

def test_edge_interact_t3_alert_and_correct():
    """
    Full cycle test:
    1. Inject T3 alert → edge AI suggests correct_param
    2. Apply correction via /api/edge/correct
    3. Verify node property updated
    """
    from src.main import storage, rule_engine
    storage.graph.clear()
    rule_engine.alerts.clear()

    # Setup
    storage.add_node("sensor_01", ["Sensor"], {"cn": 70})
    rule_engine.alerts.append(AlertEvent("sensor_01", "T3", "T3因果机理异常", 99.0, "SCS-CN-T3"))
    
    # Get action
    res = client.get("/api/edge/interact")
    assert res.status_code == 200
    action = res.json()["action"]
    assert action["action"] == "correct_param"
    assert action["node_id"] == "sensor_01"
    assert action["param"] == "cn"
    assert action["value"] == 85
    
    # Apply correction
    correct_res = client.post("/api/edge/correct", json={
        "node_id": action["node_id"],
        "param": action["param"],
        "value": action["value"]
    })
    assert correct_res.status_code == 200
    assert correct_res.json()["status"] == "success"
    
    # Verify node property updated (get_node returns flat networkx attr dict)
    node = storage.get_node("sensor_01")
    assert node["cn"] == 85

def test_edge_correct_missing_params():
    """Calling /api/edge/correct with missing params should return 400."""
    res = client.post("/api/edge/correct", json={"node_id": "x"})
    assert res.status_code == 400

def test_edge_correct_node_not_found():
    """Calling /api/edge/correct with nonexistent node should return 404."""
    from src.main import storage, rule_engine
    storage.graph.clear()
    rule_engine.alerts.clear()
    res = client.post("/api/edge/correct", json={"node_id": "nonexistent", "param": "cn", "value": 80})
    assert res.status_code == 404

