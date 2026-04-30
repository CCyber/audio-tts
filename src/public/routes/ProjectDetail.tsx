import { useParams } from "@solidjs/router";
import { Header } from "../components/shell/Header";
export function ProjectDetail() {
  const params = useParams();
  return <><Header title={<span>Projekt {params.id}</span>} /><div style={{ padding: "var(--space-4)" }}>ProjectDetail {params.id} (TODO)</div></>;
}
