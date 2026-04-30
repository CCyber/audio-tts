import { uiState, closeCompose } from "../../stores/ui";
import { Sheet } from "../common/Sheet";

export function ComposeSheet() {
  return (
    <Sheet open={uiState.composeOpen} onClose={closeCompose} title="Neue Aufnahme">
      <div>TODO</div>
    </Sheet>
  );
}
