import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { errorMessage } from "../../api/errors";
import { useI18n } from "../../i18n";

type Access = Awaited<ReturnType<typeof api.codexStatus>>;
type Login = Awaited<ReturnType<typeof api.codexLogin>>;
export default function CodexConnection({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Access | null>(null);
  const [login, setLogin] = useState<Login | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const changed = useRef(onChanged); changed.current = onChanged;
  useEffect(() => {
    mounted.current = true;
    api.codexStatus().then(value => { if (mounted.current) setStatus(value); })
      .catch(error => { if (mounted.current) setError(errorMessage(error)); });
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!login) return;
    let alive = true, reading = false;
    const timer = setInterval(async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await api.codexStatus();
        if (!alive) return;
        setStatus(next);
        if (next.authenticated) { setLogin(null); changed.current(); }
        else if (next.error || !next.available) { setLogin(null); if (next.error) setError(next.error); }
      } catch (error) { if (alive) setError(errorMessage(error)); }
      finally { reading = false; }
    }, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [login]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); }
    catch (error) { if (mounted.current) setError(errorMessage(error)); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section className="codex-connection" aria-label={t("codex.title")}>
    <p>{t("codex.usage")}</p>
    {error && <p className="err" role="alert">{error}</p>}
    {status?.error && <p className="muted">{status.error}</p>}
    {!status ? <p className="muted">{t("common.loading")}</p> : !status.available ? <p>{t("codex.install")} <a href="https://developers.openai.com/codex/cli" target="_blank" rel="noreferrer">{t("codex.installLink")}</a></p> :
      status.authenticated ? <>
        <p className="ok">{t("codex.connected", { account: status.email ?? "Codex", plan: status.plan ?? "ChatGPT" })}</p>
        {!status.imageGeneration && <p className="muted">{t("codex.noImages")}</p>}
        <button type="button" disabled={busy} onClick={() => void run(async () => {
          await api.codexLogout(); const next = await api.codexStatus();
          if (mounted.current) { setStatus(next); changed.current(); }
        })}>{t("codex.logout")}</button>
      </> : login ? <div className="codex-login">
        <p>{t("codex.enterCode")}</p><input className="codex-device-code" readOnly aria-label={t("codex.title")} value={login.userCode}/>
        <a className="btn-link" href={login.verificationUrl} target="_blank" rel="noreferrer">{t("codex.openLogin")}</a>
        <p className="muted">{t("codex.waiting")}</p>
        <button disabled={busy} onClick={() => void run(async () => {
          await api.codexCancelLogin(login.loginId); if (mounted.current) setLogin(null);
        })}>{t("common.cancel")}</button>
      </div> : <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => {
        const next = await api.codexLogin(); if (mounted.current) setLogin(next);
      })}>{busy ? t("common.loading") : t("codex.login")}</button>}
  </section>;
}
