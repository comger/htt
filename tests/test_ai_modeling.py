from fastapi.testclient import TestClient
from src.main import app

client = TestClient(app)

def test_ai_extraction_api():
    response = client.post("/api/ai/extract", json={"text": "A water reservoir with max level 100m"})
    assert response.status_code == 200
    
    data = response.json()
    assert data["status"] == "success"
    
    extracted = data["extracted"]
    assert "nodes" in extracted
    assert len(extracted["nodes"]) > 0
    
    # Verify node structure (id and properties present)
    first_node = extracted["nodes"][0]
    assert "id" in first_node
    assert "properties" in first_node or "labels" in first_node
    
def test_graph_endpoints():
    # Sync a node
    res = client.post("/api/nodes", json={
        "id": "test_sync_node",
        "labels": ["TestLabel"],
        "properties": {"x": 10, "y": 20}
    })
    assert res.status_code == 200
    
    # Get graph
    res_graph = client.get("/api/graph")
    data = res_graph.json()
    nodes = data["nodes"]
    
    found = any(n["id"] == "test_sync_node" for n in nodes)
    assert found
