# Locust body picking

Repair for PR #19, based on signed `202763563dc48f8fea4c02464ebcbf8c485bfd1b`.

The browser must let a primary click grab a locust anywhere on its current visible body, including the trailing particles. With another swarm selected, clicking that tail must select the locust rather than order the previous swarm. Preserve the existing forgiving centre target, primary map orders, keyboard controls and all simulation/combat radii.

Keep the existing circular centre target for every type. Extend only locust picking with its heading-aligned nose and a narrow capsule enclosing the rendered tail, including pixel/streak tolerance. Use the interpolated position and last rendered heading, not server coordinates or a larger circular target that would intercept unrelated map orders beside the swarm. Old fading trails and the spore range ring are not body targets.

## Regression

`e2e/locust-picking.spec.js` starts a real ephemeral offline server and a hold opening. It reads real server state and canvas pixels, then uses Brave's native pointer input at a bright visible tail pixel beyond the old radius. No game state, stream, input or acknowledgement is mocked. Cover desktop (1440×900) and portrait (390×844), both no selection and a different swarm selected. Assert the selected swarm, absence of an unintended `/input`, centre selection, and an accepted map order with the actual transformed destination in server state. Save screenshots and sanitized geometry as test attachments.

Run the new test RED before changing picking, then GREEN unchanged. Run repository syntax checks, build, Node tests and the existing mode-picker/narrow-map browser tests. No merge or deployment is included.
