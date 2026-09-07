# Daily preparation progress

The Home screen retained its local preparation error after the server later
created the daily draft. It now suppresses obsolete preparation feedback whenever
the daily draft is available, while keeping errors from approve/edit/skip actions.

The review worker persists four milestones in an additive `review_deliveries.stage`
column: discovering, judging, writing and saving. An authenticated, account-scoped,
uncached GET on `/api/review-delivery` reports these milestones and whether work is
active, waiting for retry, paused, or ready. A saved daily post always wins over
an older failure or unfinished delivery ledger. Existing completed posts work
without a stage backfill.

Windows and Android show a step-based progress bar. It advances only as server
milestones finish; it does not estimate token completion or time remaining.
Waiting/retry states retain the last completed step. The app polls every three
seconds during preparation and fifteen seconds otherwise, without overlapping
polls, pausing in the background and cancelling on screen disposal. Once a new
daily post is detected, it refreshes the workspace automatically. Connection loss
is labelled as showing the last known step.

TypeScript compilation and Windows release compilation passed. No test suite,
app launch or live generation/publication was requested by the implementation.
The user continues to perform acceptance testing. Android build/install results
are recorded in the delivery response. Windows ZIP replaced in Downloads.
