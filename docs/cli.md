# CLI

Install globally or use via `npx`.

## Failed Queue
- List: `quartz failed:list --prefix quartz --redis redis://localhost:6379 --count 20`
- Requeue: `quartz failed:requeue --idx 0 --reset`
- Delete: `quartz failed:delete --idx 0`
- Export: `quartz failed:drain-to-file --out failed.json --purge`
- Import: `quartz failed:import-from-file --in failed.json`
- By id: `failed:get|requeue-id|delete-id`

## Definitions
- List: `quartz defs:list`
- Add: `quartz defs:add --file job.json`
- Remove: `quartz defs:remove --id job_id`
- Reload: `quartz defs:reload`
