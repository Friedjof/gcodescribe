import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import LiveViewer from "./stream/LiveViewer";
import Upload from "./components/Upload";
import { ToastProvider } from "./components/Toasts";
import { I18nProvider } from "./i18n";
import "./styles.css";

// /upload is the public submission page shared during events; everything
// else is the regular (admin) app.
const isUpload = window.location.pathname.replace(/\/+$/, "") === "/upload";
const isLive = window.location.pathname.replace(/\/+$/, "") === "/live";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <ToastProvider>{isLive ? <LiveViewer /> : isUpload ? <Upload /> : <App />}</ToastProvider>
    </I18nProvider>
  </React.StrictMode>
);
