import json
import logging
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

class EdgeModelManager:
    def __init__(self, model_path: str = None):
        self.model_path = model_path
        self.llama = None
        self.is_mock = True

        if self.model_path:
            try:
                from llama_cpp import Llama
                self.llama = Llama(model_path=self.model_path, n_ctx=2048)
                self.is_mock = False
                logger.info(f"Loaded edge model from {self.model_path}")
            except ImportError:
                logger.warning("llama_cpp not installed, using mock Edge AI.")
            except Exception as e:
                logger.warning(f"Failed to load model {self.model_path}: {e}. Using mock Edge AI.")
        else:
            logger.info("No edge model path provided. Using mock Edge AI.")

    def generate_action(self, graph_state: Dict[str, Any], alerts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Generate an action based on graph state and recent alerts.
        Returns a JSON object representing the action.
        """
        if self.is_mock:
            return self._generate_mock_action(graph_state, alerts)
        else:
            return self._generate_real_action(graph_state, alerts)

    def _generate_mock_action(self, graph_state: Dict[str, Any], alerts: List[Dict[str, Any]]) -> Dict[str, Any]:
        # Simple rule-based mock logic for demonstration
        if not alerts:
            return {"action": "none"}
        
        latest_alert = alerts[-1]
        node_id = latest_alert.get("node_id")
        
        # If it's a T3 alert, maybe suggest a parameter correction
        if latest_alert.get("level") == "T3":
            # Mock parameter correction: adjust CN parameter if it's a watershed
            return {
                "action": "correct_param",
                "node_id": node_id,
                "param": "cn",
                "value": 85,
                "reason": "T3 mechanism audit triggered, adjusting CN to recalibrate surface runoff."
            }
        
        # Default action: just click/highlight the problematic node
        return {
            "action": "click",
            "node_id": node_id,
            "reason": "Anomaly detected, inspecting node."
        }

    def _generate_real_action(self, graph_state: Dict[str, Any], alerts: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not self.llama:
            return {"action": "none"}
            
        prompt = self._build_prompt(graph_state, alerts)
        
        try:
            response = self.llama(
                prompt,
                max_tokens=128,
                stop=["\n", "}"],
                echo=False
            )
            text = response["choices"][0]["text"].strip()
            # Try to parse the output as JSON. Note: in real usage, we should use grammar constraints
            if not text.endswith("}"):
                text += "}"
            return json.loads(text)
        except Exception as e:
            logger.error(f"Failed to generate real action: {e}")
            return {"action": "none"}

    def _build_prompt(self, graph_state: Dict[str, Any], alerts: List[Dict[str, Any]]) -> str:
        prompt = (
            "You are an edge AI diagnostic assistant. "
            "You observe the following graph state and recent alerts. "
            "Respond ONLY with a JSON object. No explanation.\n"
            f"Alerts: {json.dumps(alerts[-3:])}\n"
            "If T3 alert, output: {\"action\": \"correct_param\", \"node_id\": \"...\", \"param\": \"cn\", \"value\": 80, \"reason\": \"...\"}\n"
            "If T1/T2 alert, output: {\"action\": \"click\", \"node_id\": \"...\", \"reason\": \"...\"}\n"
            "If no alerts, output: {\"action\": \"none\"}\n"
            "JSON Response: {"
        )
        return prompt
