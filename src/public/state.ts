import type { Project, Recording, TagWithCount } from "./api";

export interface AppState {
  projects: Project[];
  tags: TagWithCount[];
  selectedProjectId: number;
  activeTagFilters: string[];
  searchQuery: string;
  recordings: Recording[];
  voices: Array<{ _id: string; title: string }>;
  models: string[];
}

type Listener = () => void;

class Store {
  state: AppState = {
    projects: [],
    tags: [],
    selectedProjectId: 1,
    activeTagFilters: [],
    searchQuery: "",
    recordings: [],
    voices: [],
    models: [],
  };
  private listeners: Listener[] = [];

  set(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l());
  }

  subscribe(l: Listener): void {
    this.listeners.push(l);
  }
}

export const store = new Store();
