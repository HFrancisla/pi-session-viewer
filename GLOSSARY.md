# Pi Session Viewer

A read-only viewer for Pi sessions that presents a session timeline and details for a selected event.

## Timeline and selection

**Visible event**:
A session event included by the selected branch and the current event-kind filters. Visibility in the timeline is independent from selection in the Inspector.

**Selected event**:
The session event whose details the Inspector presents. It remains selected when its timeline row is hidden by a filter; an explicit jump to it makes its event kind visible.

**Focused event**:
The visible timeline event currently targeted by keyboard navigation. It may differ from the selected event, and moving focus alone does not change the Inspector selection.

**Session View**:
The current presentation of one Session on a selected branch. Event-kind filters determine its Visible events, while the Selected event drives the Inspector and the Focused event remains independent.
