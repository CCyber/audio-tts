import { render } from "solid-js/web";

const App = () => <h1 style="font-family: system-ui">Aria — boot ok</h1>;

const root = document.getElementById("app");
if (!root) throw new Error("no #app");
render(() => <App />, root);
