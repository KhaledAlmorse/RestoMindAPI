/**
 * Pin the test suite's timezone.
 *
 * Every business date on this service is a Cairo date derived through
 * `src/Common/Utils/date.util.ts`, and the recurring defect this branch keeps
 * hitting is code that reaches for the *server's* local day instead. Whether a
 * test catches that therefore depended on the timezone of whoever ran it: on a
 * developer box already set to Africa/Cairo, server-local and Cairo midnight
 * coincide and the regression hides.
 *
 * UTC is deliberate, not merely neutral — it is the least forgiving setting
 * available. It maximises the offset between "server local" and "Cairo" (2h in
 * winter, 3h in summer, never zero), so an assertion that quietly relies on the
 * two agreeing fails here rather than in production. It is also what CI
 * containers run as.
 *
 * This must be `globalSetup`, not `setupFiles`. Assigning `process.env.TZ`
 * inside a worker's test context does not move V8's already-initialised
 * timezone for that context — verified on this repo: the variable read back as
 * 'UTC' while `getTimezoneOffset()` still reported Cairo. `globalSetup` runs in
 * the main process *before* the workers are forked, so each worker inherits the
 * variable at process start and initialises its clock from it correctly.
 */
module.exports = async () => {
  process.env.TZ = 'UTC';
};
