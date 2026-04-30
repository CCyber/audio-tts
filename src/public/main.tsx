import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import { AppShell } from "./components/shell/AppShell";
import { Home } from "./routes/Home";
import { Projects } from "./routes/Projects";
import { ProjectDetail } from "./routes/ProjectDetail";
import { Library } from "./routes/Library";
import { Search } from "./routes/Search";
import "./styles/theme.css";
import "./styles/globals.css";

const App = (props: { children?: any }) => <AppShell>{props.children}</AppShell>;

const root = document.getElementById("app");
if (!root) throw new Error("no #app");

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Home} />
      <Route path="/projects" component={Projects} />
      <Route path="/projects/:id" component={ProjectDetail} />
      <Route path="/library" component={Library} />
      <Route path="/search" component={Search} />
    </Router>
  ),
  root
);
