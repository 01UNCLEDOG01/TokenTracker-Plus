import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { InsforgeAuthProvider } from "./contexts/InsforgeAuthContext.jsx";
import { AccountViewProvider } from "./contexts/AccountViewContext.jsx";
import { LocaleProvider } from "./ui/foundation/LocaleProvider.jsx";
import { CurrencyProvider } from "./ui/foundation/CurrencyProvider.jsx";
import { TokenFormatProvider } from "./ui/foundation/TokenFormatProvider.jsx";
import App from "./App.jsx";
import { ensureCopyLocale } from "./lib/copy";
import { getInitialLocalePreference, resolvePreferredLocale } from "./lib/locale";
import { initAnalytics } from "./lib/analytics.js";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/700.css";
import "@fontsource/geist-mono/900.css";
import "./styles.css";

initAnalytics();

const router = createBrowserRouter([
  { path: "*", element: <App /> },
]);

// 语言包按语言拆 chunk（2026-11-13 性能批）：挂载前只等当前语言那一小包，
// 其余语言在切换时按需加载。
async function bootstrap() {
  await ensureCopyLocale(resolvePreferredLocale(getInitialLocalePreference()));
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <LocaleProvider>
        <TokenFormatProvider>
          <CurrencyProvider>
            <InsforgeAuthProvider>
              <AccountViewProvider>
                <RouterProvider router={router} />
              </AccountViewProvider>
            </InsforgeAuthProvider>
          </CurrencyProvider>
        </TokenFormatProvider>
      </LocaleProvider>
    </React.StrictMode>,
  );
}
bootstrap();
