import sqlite3
import json
import networkx as nx
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

class NodeModel(BaseModel):
    id: str
    labels: List[str]
    properties: Dict[str, Any]

class EdgeModel(BaseModel):
    source: str
    target: str
    type: str
    properties: Dict[str, Any]

class LightGraphStorage:
    """
    轻量级图谱存储引擎，结合 NetworkX (内存计算) 和 SQLite (持久化)。
    满足 1~3T 算力和极低内存的边缘端需求。
    """
    def __init__(self, db_path: str = "data/htt_graph.db"):
        self.db_path = db_path
        self.graph = nx.DiGraph()
        self._init_db()
        self.load_from_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS nodes (
                    id TEXT PRIMARY KEY,
                    labels TEXT,
                    properties TEXT
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS edges (
                    source TEXT,
                    target TEXT,
                    type TEXT,
                    properties TEXT,
                    PRIMARY KEY (source, target, type)
                )
            ''')
            conn.commit()

    def load_from_db(self):
        """从 SQLite 加载图结构到 NetworkX"""
        self.graph.clear()
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Load Nodes
            cursor.execute("SELECT id, labels, properties FROM nodes")
            for row in cursor.fetchall():
                node_id = row[0]
                labels = json.loads(row[1]) if row[1] else []
                properties = json.loads(row[2]) if row[2] else {}
                self.graph.add_node(node_id, labels=labels, **properties)
                
            # Load Edges
            cursor.execute("SELECT source, target, type, properties FROM edges")
            for row in cursor.fetchall():
                source, target, edge_type = row[0], row[1], row[2]
                properties = json.loads(row[3]) if row[3] else {}
                self.graph.add_edge(source, target, type=edge_type, **properties)

    def save_node_to_db(self, node: NodeModel):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT OR REPLACE INTO nodes (id, labels, properties)
                VALUES (?, ?, ?)
            ''', (node.id, json.dumps(node.labels), json.dumps(node.properties)))
            conn.commit()

    def save_edge_to_db(self, edge: EdgeModel):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT OR REPLACE INTO edges (source, target, type, properties)
                VALUES (?, ?, ?, ?)
            ''', (edge.source, edge.target, edge.type, json.dumps(edge.properties)))
            conn.commit()

    def add_node(self, node_id: str, labels: List[str] = None, properties: Dict[str, Any] = None):
        labels = labels or []
        properties = properties or {}
        
        # Update memory
        self.graph.add_node(node_id, labels=labels, **properties)
        
        # Persist
        node_model = NodeModel(id=node_id, labels=labels, properties=properties)
        self.save_node_to_db(node_model)

    def add_edge(self, source: str, target: str, edge_type: str, properties: Dict[str, Any] = None):
        properties = properties or {}
        
        # Update memory
        self.graph.add_edge(source, target, type=edge_type, **properties)
        
        # Persist
        edge_model = EdgeModel(source=source, target=target, type=edge_type, properties=properties)
        self.save_edge_to_db(edge_model)

    def get_node(self, node_id: str) -> Optional[Dict[str, Any]]:
        if self.graph.has_node(node_id):
            return self.graph.nodes[node_id]
        return None

    def get_edge(self, source: str, target: str) -> Optional[Dict[str, Any]]:
        if self.graph.has_edge(source, target):
            return self.graph[source][target]
        return None

    def get_all_nodes(self):
        return dict(self.graph.nodes(data=True))
