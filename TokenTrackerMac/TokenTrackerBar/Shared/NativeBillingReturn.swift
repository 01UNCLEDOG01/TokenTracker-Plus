import Foundation

// Vendored from upstream: `NativeBillingReturn` parsed
// `tokentracker://billing/return?order=<uuid>` deep links for the hosted
// checkout flow. TT-Plus has no hosted billing (hosted-only, no cloud in
// TT-Plus), so the parser and every call site are gone. The file stays only
// because the committed Xcode project references this path.
