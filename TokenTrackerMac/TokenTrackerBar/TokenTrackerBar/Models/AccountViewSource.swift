import Foundation

// Vendored from upstream, this file carried the hosted account-view authority:
// the local server answered `?account=1` with either the cross-device account
// aggregate or this-machine data tagged `X-TokenTracker-Account-View` /
// `X-TokenTracker-Account-Fallback`, and the view model used that tag to avoid
// replacing an account snapshot with a transient local fallback.
//
// TT-Plus has no cloud backend (hosted-only, no cloud in TT-Plus), so every
// payload is this machine's data. The account/fallback distinction, its state
// store and the header parsing are gone. Only the result wrapper survives,
// because the view model publishes a decoded value together with its authority
// and completion time.

/// A decoded payload plus the publication authority it was served with.
/// The authority is always `.localQueue`: this app never shows a cross-device
/// aggregate.
struct AccountFetchResult<Value> {
    let value: Value
    let source: UsageSummaryViewSource
    let completedAt: Date
}
