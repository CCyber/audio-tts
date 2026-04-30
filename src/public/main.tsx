import { render } from "solid-js/web";
import "./styles/theme.css";
import "./styles/globals.css";

const App = () => <h1>Aria — boot ok</h1>;

const root = document.getElementById("app");
if (!root) throw new Error("no #app");
render(() => <App />, root);
