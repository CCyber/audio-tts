import { createStore } from "solid-js/store";
import { api, Project, TagWithCount, Recording } from "../lib/api";

export interface LibraryState {
  recordings: Recording[];
  projects: Project[];
  tags: TagWithCount[];
  loading: boolean;
  error: string | null;
}

const [libraryState, setLibraryState] = createStore<LibraryState>({
  recordings: [],
  projects: [],
  tags: [],
  loading: false,
  error: null,
});

export { libraryState };

export async function loadAll(): Promise<void> {
  setLibraryState({ loading: true, error: null });
  try {
    const [projects, tags, recordings] = await Promise.all([
      api.listProjects(),
      api.listTags(),
      api.listRecordings(),
    ]);
    setLibraryState({ projects, tags, recordings, loading: false });
  } catch (err) {
    setLibraryState({ loading: false, error: (err as Error).message });
  }
}

export function upsertRecording(rec: Recording): void {
  const existing = libraryState.recordings.findIndex((r) => r.id === rec.id);
  if (existing >= 0) {
    setLibraryState("recordings", existing, rec);
  } else {
    setLibraryState("recordings", (prev) => [rec, ...prev]);
  }
}

export function removeRecording(id: number): void {
  setLibraryState("recordings", (prev) => prev.filter((r) => r.id !== id));
}

export function upsertProject(project: Project): void {
  const existing = libraryState.projects.findIndex((p) => p.id === project.id);
  if (existing >= 0) {
    setLibraryState("projects", existing, project);
  } else {
    setLibraryState("projects", (prev) => [...prev, project]);
  }
}

export function removeProject(id: number): void {
  setLibraryState("projects", (prev) => prev.filter((p) => p.id !== id));
}

export function pendingRecordings(): Recording[] {
  return libraryState.recordings.filter((r) => r.status === "generating");
}
