# src/templates.py
# 内置的常规场景本体模型模板，符合 HTT (T1物理限界/T2数理限界/T3机理限界) 设计规范

DEFAULT_TEMPLATES = {
    "watershed_flood": {
        "name": "小流域山洪防御",
        "description": "基于 SCS-CN 产流和瞬时单位线 (IUH) 汇流原理的小流域山洪预警监测模型。",
        "graph": {
            "nodes": [
                {"id": "rain_gauge_1", "labels": ["Sensor", "RainGauge"], "properties": {
                    "name": "上游雨量站", 
                    "t1_range_max": 500.0, 
                    "t2_alert_1h": 30.0,
                    "t2_alert_3h": 50.0
                }},
                {"id": "catchment_area_1", "labels": ["Environment", "Catchment"], "properties": {
                    "name": "山洪汇水区 (SCS-CN)", 
                    "area_km2": 15.5,
                    "scs_cn_value": 75.0,
                    "initial_abstraction_ratio": 0.2,
                    "time_of_concentration_hr": 1.5,
                    "main_channel_length_km": 5.2,
                    "average_slope_percent": 12.5
                }},
                {"id": "river_section_1", "labels": ["Environment", "RiverSection"], "properties": {
                    "name": "河道关键断面", 
                    "manning_roughness": 0.035,
                    "bottom_width_m": 15.0,
                    "side_slope_ratio": 1.5
                }},
                {"id": "water_level_1", "labels": ["Sensor", "WaterLevel"], "properties": {
                    "name": "断面水位计", 
                    "t1_range_max": 20.0, 
                    "t2_warning_level": 2.5,
                    "t2_guarantee_level": 3.5
                }},
            ],
            "edges": [
                {"source": "rain_gauge_1", "target": "catchment_area_1", "type": "测算面雨量", "properties": {"weight": 1.0}},
                {"source": "catchment_area_1", "target": "river_section_1", "type": "产汇流输出", "properties": {"t3_iuh_lag_time_hr": 1.2}},
                {"source": "river_section_1", "target": "water_level_1", "type": "被监测", "properties": {}},
            ]
        }
    },
    "reservoir_flood": {
        "name": "水库防洪调度",
        "description": "水库防洪的经典模型，包含大坝、库区水位、下泄闸门与下游控制断面。",
        "graph": {
            "nodes": [
                {"id": "res_level_1", "labels": ["Sensor", "WaterLevel"], "properties": {
                    "name": "库区水位计", 
                    "t1_range_max": 150.0,
                    "t2_warning_level": 120.0
                }},
                {"id": "dam_1", "labels": ["Facility", "Dam"], "properties": {
                    "name": "主坝", 
                    "t1_max_height": 135.0,
                    "normal_pool_level": 115.0,
                    "dead_water_level": 90.0,
                    "design_flood_level": 125.0,
                    "check_flood_level": 130.0
                }},
                {"id": "spillway_gate_1", "labels": ["Facility", "Gate"], "properties": {
                    "name": "泄洪闸门", 
                    "t1_max_flow": 500.0,
                    "hole_width_m": 5.0,
                    "hole_height_m": 4.5
                }},
                {"id": "downstream_level_1", "labels": ["Sensor", "WaterLevel"], "properties": {
                    "name": "下游防洪断面", 
                    "t1_range_max": 100.0,
                    "t2_warning_level": 85.0
                }},
            ],
            "edges": [
                {"source": "res_level_1", "target": "dam_1", "type": "measures_level_for", "properties": {}},
                {"source": "dam_1", "target": "spillway_gate_1", "type": "contains", "properties": {}},
                {"source": "spillway_gate_1", "target": "downstream_level_1", "type": "discharges_to", "properties": {"t3_lag_time_mins": 30}},
            ]
        }
    },
    "gate_dispatch": {
        "name": "闸门防洪与水资源调度",
        "description": "应用于平原河网或灌区的多级闸门联动与水资源调配监控。",
        "graph": {
            "nodes": [
                {"id": "up_level_1", "labels": ["Sensor", "WaterLevel"], "properties": {
                    "name": "闸前水位计",
                    "t1_range_max": 10.0,
                    "t2_warning_level": 5.5
                }},
                {"id": "control_gate_1", "labels": ["Facility", "Gate"], "properties": {
                    "name": "节制闸", 
                    "t1_max_opening_m": 3.0,
                    "t1_max_flow": 120.0
                }},
                {"id": "down_level_1", "labels": ["Sensor", "WaterLevel"], "properties": {
                    "name": "闸后水位计", 
                    "t1_range_max": 10.0,
                    "t2_warning_level": 4.0
                }},
                {"id": "flow_meter_1", "labels": ["Sensor", "FlowMeter"], "properties": {
                    "name": "下泄流量计",
                    "t1_range_max": 200.0
                }},
            ],
            "edges": [
                {"source": "up_level_1", "target": "control_gate_1", "type": "upstream_of", "properties": {"distance_m": 50}},
                {"source": "control_gate_1", "target": "down_level_1", "type": "discharges_to", "properties": {"distance_m": 50}},
                {"source": "control_gate_1", "target": "flow_meter_1", "type": "measured_by", "properties": {}},
            ]
        }
    },
    "geo_slope": {
        "name": "地质边坡",
        "description": "适用于地质灾害、公路/铁路边坡的健康监测模型。",
        "graph": {
            "nodes": [
                {"id": "slope_1", "labels": ["Environment", "Slope"], "properties": {
                    "name": "一号滑坡体",
                    "slope_angle_deg": 45.0,
                    "t1_safety_factor_min": 1.15
                }},
                {"id": "gnss_1", "labels": ["Sensor", "Displacement"], "properties": {
                    "name": "表面位移计(GNSS)",
                    "t1_range_max": 1000.0,
                    "t2_alert_rate_mm_day": 2.0,
                    "t2_alert_accum_mm": 50.0
                }},
                {"id": "inclinometer_1", "labels": ["Sensor", "Displacement"], "properties": {
                    "name": "深部测斜仪",
                    "t1_range_max": 500.0,
                    "t2_alert_accum_mm": 30.0
                }},
                {"id": "rain_gauge_2", "labels": ["Sensor", "RainGauge"], "properties": {
                    "name": "环境雨量站",
                    "t1_range_max": 500.0,
                    "t2_alert_1h": 20.0
                }},
            ],
            "edges": [
                {"source": "gnss_1", "target": "slope_1", "type": "monitors_surface", "properties": {}},
                {"source": "inclinometer_1", "target": "slope_1", "type": "monitors_deep", "properties": {}},
                {"source": "rain_gauge_2", "target": "slope_1", "type": "affects", "properties": {"t3_lag_time_mins": 120}},
            ]
        }
    }
}
