import "cesium/Build/Cesium/Widgets/widgets.css";

import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

window.CESIUM_BASE_URL = "/cesiumStatic/";

createRoot(document.getElementById("root")).render(<App />);
