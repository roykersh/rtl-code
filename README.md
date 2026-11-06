# rtl-mode

A Claude Code mod for reading Hebrew in the transcript.

- `/rtl` toggles RTL mode, and `/rtl on` and `/rtl off` set it. The choice is saved across sessions.
- A small **RTL ON/OFF** button (ON in green) toggles it with a click. In the terminal it sits under the input box, at the right of the prompt footer beside the session's mode labels; in the desktop app it stays as a pill above the prompt.
- While the draft in the input box holds Hebrew, a mirrored preview of it (right to left, with a blinking caret) shows above the box. The ▾ mark beside it folds it down to a single ▸ mark, and pressing ▸ opens it again. The choice is saved across sessions.
- When it is on, every transcript line that has Hebrew gets a direction from the language most of its letters are in. Text inside quotes, code spans and links is not counted.
  - A line that is mostly Hebrew reads right to left (U+200F U+202B), and each English code span in it is embedded left to right.
  - A line that is mostly English stays left to right (U+200E U+202A), and each mostly-Hebrew quote and every other Hebrew run is embedded right to left.
  - The marks go after markdown markers (`#`, `-`, `>`, numbering). Code blocks are left alone, and table cells are handled one by one. Only the display changes: nothing stored or sent to the model is touched.
- When it is on, Claude also gets writing rules for mixed Hebrew/English answers. These apply to new sessions. When you toggle it in the middle of a session, the change is sent to Claude as a note.

Run the tests with `claude plugin test .`.
