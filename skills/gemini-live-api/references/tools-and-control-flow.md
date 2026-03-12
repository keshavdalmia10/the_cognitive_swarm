# Tools And Control Flow

Use this file when the live session needs function calling, grounded lookups, or a predictable turn loop.

## Core Pattern

1. Declare tools in the live session config with a tight schema.
2. Listen for incoming tool calls from the model.
3. Validate arguments before executing anything side-effectful.
4. Run the tool outside the model.
5. Send a tool response with the matching call identifier.
6. Let the model continue the same live interaction.

## Design Rules

- Keep tool names stable and specific.
- Keep schemas narrow. Avoid huge optional objects when a few required fields are enough.
- Return compact structured results, not long prose blobs.
- Prefer backend-owned tool execution, even if the UI captures the input stream.
- If the product depends on the model always using a tool, reinforce that in the system instruction and validate the behavior in tests.

## Failure Modes To Check

- The model emits a tool call but the app never sends a matching tool response.
- Tool handlers throw and the error is swallowed, leaving the session hanging.
- The schema is too loose, so the model produces ambiguous arguments.
- Transport and tool errors are logged together, making it hard to debug the actual failure.

## Debugging Approach

- Log raw tool call envelopes during development.
- Log tool execution start, validation failure, completion, and response send.
- Check that each tool response uses the same call ID the model sent.
- If the model stalls after a tool call, assume the response path is broken until proven otherwise.

## Grounding And Other Built-In Tools

- Verify current Live API support in official Google docs before promising a specific built-in tool in a live session.
- If a built-in tool is optional or preview-only, keep the app architecture resilient to that feature being unavailable.
