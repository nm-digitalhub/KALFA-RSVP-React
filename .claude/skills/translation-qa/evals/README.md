# Running the evals

**Unit tests**, from the project root:

```bash
node --test .claude/skills/translation-qa/scripts/check_translations.test.mjs
```

**Case folders** follow the skill-creator format and run with `claude plugin eval`. `finds-defects-in-real-files` builds its files from the project's translations, so run its `place-files.sh` from the project root.

**Activation**, with `trigger-queries.json`, in two ways that answer different questions:

- `run_trigger.py` tests the installed skill among all the project's skills: `python3 evals/run_trigger.py evals/trigger-queries.json 3 4 100`. Each child has only the Skill tool, with no hooks, so it can't change anything.
- skill-creator's `run_eval.py` tests the description alone. Run it from an empty folder holding a `.claude` folder, because in this project the installed skill competes with its temporary copy.

Run `run_eval.py` with `--num-workers 1`, and pass `--timeout 60`. With 6 workers every should-trigger query scored 0, and with one worker all 17 passed. The likely cause is that several identical temporary copies exist at once, so the model can pick another worker's copy, but that cause was not measured.

The two tests can disagree, and in an empty folder the skill's name carries much of the choice. With the name `translation-qa`, the description fired on 7 of 17 requests it should not. The same description under the neutral name `file-review-tool` fired on none of those 7, but also missed 2 of 3 requests it should catch. So a bad score there comes from the name, and rewording the description won't fix it. Judge precision from the run inside the project, where the real list of skills competes.
