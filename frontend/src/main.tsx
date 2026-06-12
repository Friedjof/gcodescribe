import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Upload from "./components/Upload";
import { I18nProvider } from "./i18n";
import "./styles.css";

// /upload is the public submission page shared during events; everything
// else is the regular (admin) app.
const isUpload = window.location.pathname.replace(/\/+$/, "") === "/upload";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>{isUpload ? <Upload /> : <App />}</I18nProvider>
  </React.StrictMode>
);
