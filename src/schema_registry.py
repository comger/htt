# src/schema_registry.py
from typing import Dict, Any, List
import json
import os

SCHEMA_DB_PATH = "data/schemas.json"

DEFAULT_NODE_SCHEMAS = {
    "WaterLevelSensor": {
        "id": "WaterLevelSensor",
        "name": "水位传感器 (Water Level)",
        "category": "Sensor",
        "attributes": [
            {"name": "t1_range_max", "type": "number", "default": 20.0, "description": "设备物理量程上限"}
        ],
        "bound_algorithms": [
            {"algo_id": "t1_physical_limit", "params": {"target_property": "t1_range_max"}},
            {"algo_id": "t2_rate_of_change", "params": {"max_delta_per_hour": 1.5}}
        ]
    },
    "RainGauge": {
        "id": "RainGauge",
        "name": "雨量计 (Rain Gauge)",
        "category": "Sensor",
        "attributes": [
            {"name": "t1_range_max", "type": "number", "default": 500.0, "description": "最大降雨量程"}
        ],
        "bound_algorithms": [
            {"algo_id": "t1_physical_limit", "params": {"target_property": "t1_range_max"}},
            {"algo_id": "t2_3sigma", "params": {"window_days": 30}}
        ]
    },
    "Displacement": {
        "id": "Displacement",
        "name": "位移计 (GNSS/测斜仪)",
        "category": "Sensor",
        "attributes": [
            {"name": "t1_range_max", "type": "number", "default": 1000.0, "description": "传感器最大位移量程(mm)"},
            {"name": "t2_alert_rate_mm_day", "type": "number", "default": 2.0, "description": "速率突变预警值"}
        ],
        "bound_algorithms": [
            {"algo_id": "t1_physical_limit", "params": {"target_property": "t1_range_max"}},
            {"algo_id": "t2_rate_of_change", "params": {"max_delta_per_hour": 2.0}}
        ]
    },
    "FlowMeter": {
        "id": "FlowMeter",
        "name": "流量计 (Flow Meter)",
        "category": "Sensor",
        "attributes": [
            {"name": "t1_range_max", "type": "number", "default": 500.0, "description": "最大测量流量(m³/s)"}
        ],
        "bound_algorithms": [
            {"algo_id": "t1_physical_limit", "params": {"target_property": "t1_range_max"}},
            {"algo_id": "t2_3sigma", "params": {"window_days": 15}}
        ]
    },
    "Dam": {
        "id": "Dam",
        "name": "大坝实体 (Dam)",
        "category": "Facility",
        "attributes": [
            {"name": "t1_max_height", "type": "number", "default": 100.0, "description": "坝顶高程"},
            {"name": "design_flood_level", "type": "number", "default": 90.0, "description": "设计洪水位"},
            {"name": "dead_water_level", "type": "number", "default": 50.0, "description": "死水位"}
        ],
        "bound_algorithms": [
            {"algo_id": "t3_mass_balance", "params": {}}
        ]
    },
    "Gate": {
        "id": "Gate",
        "name": "控制闸门 (Gate)",
        "category": "Facility",
        "attributes": [
            {"name": "t1_max_opening_m", "type": "number", "default": 5.0, "description": "最大开度(m)"},
            {"name": "t1_max_flow", "type": "number", "default": 100.0, "description": "最大过流能力(m³/s)"}
        ],
        "bound_algorithms": [
            {"algo_id": "t1_physical_limit", "params": {"target_property": "t1_max_opening_m"}}
        ]
    },
    "Catchment": {
        "id": "Catchment",
        "name": "山洪汇水区 (Catchment)",
        "category": "Environment",
        "attributes": [
            {"name": "area_km2", "type": "number", "default": 10.0, "description": "流域面积(km²)"},
            {"name": "scs_cn_value", "type": "number", "default": 75.0, "description": "SCS曲线数(CN)"},
            {"name": "time_of_concentration_hr", "type": "number", "default": 1.5, "description": "汇流时间Tc(hr)"}
        ],
        "bound_algorithms": [
            {"algo_id": "t3_scs_cn", "params": {"cn_value_property": "scs_cn_value"}}
        ]
    },
    "RiverSection": {
        "id": "RiverSection",
        "name": "河道关键断面 (River Section)",
        "category": "Environment",
        "attributes": [
            {"name": "manning_roughness", "type": "number", "default": 0.035, "description": "曼宁糙率(n)"},
            {"name": "bottom_width_m", "type": "number", "default": 15.0, "description": "河底宽度(m)"}
        ],
        "bound_algorithms": []
    },
    "Slope": {
        "id": "Slope",
        "name": "地质边坡 (Slope)",
        "category": "Environment",
        "attributes": [
            {"name": "slope_angle_deg", "type": "number", "default": 45.0, "description": "坡角(度)"},
            {"name": "t1_safety_factor_min", "type": "number", "default": 1.15, "description": "极限安全系数(Fs)"}
        ],
        "bound_algorithms": [
            {"algo_id": "t1_physical_limit", "params": {"target_property": "t1_safety_factor_min"}}
        ]
    }
}

DEFAULT_EDGE_SCHEMAS = {
    "flows_into": {
        "id": "flows_into",
        "name": "产汇流输出",
        "description": "表达上游向下游的水流汇集关系",
        "attributes": [
            {"name": "t3_lag_time_hr", "type": "number", "default": 1.0, "description": "水流时滞时间(小时)"}
        ]
    },
    "monitors_area": {
        "id": "monitors_area",
        "name": "测算面雨量",
        "description": "传感器针对特定面积的测量权重",
        "attributes": [
            {"name": "weight", "type": "number", "default": 1.0, "description": "面积权重系数"}
        ]
    },
    "generic_link": {
        "id": "generic_link",
        "name": "普通关联",
        "description": "物理或逻辑上的无参数绑定",
        "attributes": []
    }
}

class SchemaRegistry:
    def __init__(self):
        self.node_schemas = {}
        self.edge_schemas = {}
        self._load()

    def _load(self):
        if os.path.exists(SCHEMA_DB_PATH):
            try:
                with open(SCHEMA_DB_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.node_schemas = data.get("node_schemas", DEFAULT_NODE_SCHEMAS.copy())
                    self.edge_schemas = data.get("edge_schemas", DEFAULT_EDGE_SCHEMAS.copy())
            except:
                self.node_schemas = DEFAULT_NODE_SCHEMAS.copy()
                self.edge_schemas = DEFAULT_EDGE_SCHEMAS.copy()
        else:
            self.node_schemas = DEFAULT_NODE_SCHEMAS.copy()
            self.edge_schemas = DEFAULT_EDGE_SCHEMAS.copy()
            self._save()

    def _save(self):
        if not os.path.exists("data"):
            os.makedirs("data")
        data = {
            "node_schemas": self.node_schemas,
            "edge_schemas": self.edge_schemas
        }
        with open(SCHEMA_DB_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def get_all_node_schemas(self):
        return self.node_schemas
        
    def get_all_edge_schemas(self):
        return self.edge_schemas

    def upsert_node_schema(self, schema_data: Dict[str, Any]):
        schema_id = schema_data.get("id")
        if not schema_id:
            raise ValueError("Schema ID is required")
        self.node_schemas[schema_id] = schema_data
        self._save()
        return self.node_schemas[schema_id]
        
    def upsert_edge_schema(self, schema_data: Dict[str, Any]):
        schema_id = schema_data.get("id")
        if not schema_id:
            raise ValueError("Schema ID is required")
        self.edge_schemas[schema_id] = schema_data
        self._save()
        return self.edge_schemas[schema_id]

    def delete_node_schema(self, schema_id: str):
        if schema_id in self.node_schemas:
            del self.node_schemas[schema_id]
            self._save()
            return True
        return False
        
    def delete_edge_schema(self, schema_id: str):
        if schema_id in self.edge_schemas:
            del self.edge_schemas[schema_id]
            self._save()
            return True
        return False
