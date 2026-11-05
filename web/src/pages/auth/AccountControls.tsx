import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Button, Checkbox, Dropdown, Form, Input, Menu, Modal, Select, Space, Typography } from '@arco-design/web-react';
import {
  clearAuthFlowBinding, completePasswordFlow, confirmRecoveryCodes, finishLogin, getFlowStatus, getRecoveryCodes,
  logout, recoverPassword, recoverTotp, registerAccount, setupTotp, startLogin, startSecurityFlow,
  synchronizeAuthSession, verifyTotp,
  type FlowPurpose, type FlowView, type RecoveryCodes, type TotpSetup
} from '../../services/authClient';
import { ApiRequestError, getErrorMessage } from '../../services/apiClient';
import { getAuthSession, onLoginRequired, setAuthSession, subscribeAuthState, type LoginPromptKind } from '../../services/authState';
import { PASSWORD_RULE_HINT, passwordByteLength, passwordValidationError } from './passwordPolicy';

type Entry = 'login' | 'register' | 'recover-password' | 'recover-totp' | 'security';
type Result = { purpose?: FlowPurpose; accountId?: string; pending?: boolean };
type SecurityKind = 'password' | 'totp' | 'recovery-codes';
const titles: Record<Entry, string> = {
  login: '登录', register: '注册', 'recover-password': '找回密码', 'recover-totp': '更换丢失的验证器', security: '账号安全'
};
const passwordPurpose = (flow: FlowView) => flow.purpose === 'reset_password' || flow.purpose === 'change_password';
const bindingPurpose = (flow: FlowView) => ['register', 'replace_totp', 'change_totp'].includes(flow.purpose);

export function AccountControls({ apiBaseUrl }: { apiBaseUrl: string }) {
  const session = useSyncExternalStore(subscribeAuthState, getAuthSession, () => null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loginPrompt, setLoginPrompt] = useState<LoginPromptKind | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => synchronizeAuthSession(apiBaseUrl), [apiBaseUrl]);
  useEffect(() => onLoginRequired(setLoginPrompt), []);

  const exitSession = async (all: boolean) => {
    if (loggingOut) return;
    setLoggingOut(true);
    setAccountError(null);
    try {
      await logout(apiBaseUrl, all);
      setEntry(null);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        setAuthSession(null, true);
        setEntry(null);
      } else setAccountError(getErrorMessage(error));
    } finally { setLoggingOut(false); }
  };

  return <>
    <Space className="account-actions">
      {session ? <Dropdown trigger="click" droplist={<Menu onClickMenuItem={key => {
        if (key === 'security') setEntry('security');
        if (key === 'logout') void exitSession(false);
        if (key === 'logout-all') void exitSession(true);
      }}>
        <Menu.Item key="security">账号安全</Menu.Item>
        <Menu.Item key="logout" disabled={loggingOut}>退出登录</Menu.Item>
        <Menu.Item key="logout-all" disabled={loggingOut}>退出全部设备</Menu.Item>
      </Menu>}>
        <Button size="small" loading={loggingOut}>{session.username} · 已开通</Button>
      </Dropdown> : <>
        <Button size="small" onClick={() => setEntry('login')}>登录</Button>
        <Button size="small" type="primary" onClick={() => setEntry('register')}>注册</Button>
      </>}
    </Space>
    {entry ? <AccountDialog key={entry} entry={entry} apiBaseUrl={apiBaseUrl} onEntryChange={setEntry} onClose={() => setEntry(null)} /> : null}
    <Modal title="需要登录" visible={loginPrompt !== null} onCancel={() => setLoginPrompt(null)}
      style={{ maxWidth: 'calc(100vw - 32px)' }}
      footer={<Button type="primary" onClick={() => setLoginPrompt(null)}>知道了</Button>}>
      {loginPrompt === 'compute' ? '需要登录后才能计算，请通过右上角入口登录。' : '请先通过右上角入口登录，再进行此操作。'}
    </Modal>
    <Modal title="账号操作失败" visible={accountError !== null} onCancel={() => setAccountError(null)}
      style={{ maxWidth: 'calc(100vw - 32px)' }}
      footer={<Button onClick={() => setAccountError(null)}>知道了</Button>}>
      {accountError}
    </Modal>
  </>;
}

function AccountDialog({ entry, apiBaseUrl, onEntryChange, onClose }: {
  entry: Entry; apiBaseUrl: string; onEntryChange: (entry: Entry) => void; onClose: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [securityKind, setSecurityKind] = useState<SecurityKind>('password');
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [codes, setCodes] = useState<RecoveryCodes | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const serial = useRef(0);
  const working = useRef(false);

  const clearSecrets = () => {
    setPassword(''); setTotpCode(''); setRecoveryCode(''); setNewPassword(''); setPasswordConfirmation('');
    setSetup(null); setCodes(null); setSavedCodes(false);
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; serial.current += 1; clearAuthFlowBinding(); };
  }, []);
  useEffect(() => {
    if (!flow) return;
    const expire = () => {
      serial.current += 1;
      clearSecrets(); setFlow(null); setBusy(false); working.current = false;
      setError('操作流程已过期。未完成注册可从登录入口提交原用户名与密码继续；其他操作请重新发起。');
    };
    const remaining = Date.parse(flow.expiresAt) - Date.now();
    if (remaining <= 0) { expire(); return; }
    const timer = setTimeout(expire, remaining);
    return () => clearTimeout(timer);
  }, [flow]);

  const finish = (current: FlowView | null, pending = current?.purpose === 'register') => {
    clearSecrets(); setFlow(null);
    setResult({ purpose: current?.purpose, accountId: current?.accountId, pending });
    if (current && current.purpose !== 'login') setAuthSession(null, true);
  };
  const withOperation = async (action: (isCurrent: () => boolean) => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    const request = ++serial.current;
    const isCurrent = () => mounted.current && serial.current === request;
    setBusy(true); setError(null);
    try { await action(isCurrent); }
    catch (cause) {
      if (!isCurrent()) return;
      if (cause instanceof ApiRequestError && cause.code === 'AUTH.LOGIN_NOT_ENABLED' && flow?.purpose === 'login') {
        finish(flow, true);
      } else if (cause instanceof ApiRequestError && cause.status === 410) {
        clearSecrets(); setFlow(null);
        setError('操作流程已过期。请重新发起；未完成注册请从登录入口使用原用户名与密码继续。');
      } else if (cause instanceof ApiRequestError && cause.code === 'AUTH.FLOW_CONFLICT') {
        setSetup(null); setCodes(null); setSavedCodes(false);
        setError('当前操作流程已改变，请查询当前进度后继续。');
      } else setError(getErrorMessage(cause));
    } finally {
      if (isCurrent()) { working.current = false; setBusy(false); }
    }
  };
  const loadMaterials = async (next: FlowView, isCurrent: () => boolean) => {
    if (!isCurrent()) return;
    setFlow(next); setTotpCode(''); setSetup(null); setCodes(null); setSavedCodes(false);
    if (next.phase === 'recovery_codes_ready') {
      const material = await getRecoveryCodes(apiBaseUrl);
      if (isCurrent()) setCodes(material);
    } else if (bindingPurpose(next)) {
      const material = await setupTotp(apiBaseUrl);
      if (isCurrent()) setSetup(material);
    }
  };
  const refreshFlow = () => withOperation(async isCurrent => {
    clearSecrets();
    const status = await getFlowStatus(apiBaseUrl);
    if (!isCurrent()) return;
    if (status.phase === 'completed') finish(flow);
    else await loadMaterials(status, isCurrent);
  });
  const validTotp = () => {
    if (/^\d{6}$/.test(totpCode)) return true;
    setError('请输入验证器中的 6 位动态码。'); return false;
  };
  const submitStart = () => {
    if (entry !== 'security' && !/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      setError('用户名须为 3～32 位字母、数字或下划线。'); return;
    }
    const passwordError = entry === 'register' ? passwordValidationError(password) : null;
    if (passwordError) { setError(passwordError); return; }
    if (entry === 'register' && password !== passwordConfirmation) { setError('两次输入的密码不一致。'); return; }
    if (entry !== 'recover-password' && !password) { setError('请输入密码。'); return; }
    if ((entry === 'security' || entry === 'recover-password') && !validTotp()) return;
    if ((entry === 'recover-password' || entry === 'recover-totp') && !recoveryCode.trim()) { setError('请输入一枚未使用的恢复码。'); return; }
    void withOperation(async isCurrent => {
      const next = entry === 'register' ? await registerAccount(apiBaseUrl, username, password)
        : entry === 'login' ? await startLogin(apiBaseUrl, username, password)
        : entry === 'recover-password' ? await recoverPassword(apiBaseUrl, username, totpCode, recoveryCode.trim())
        : entry === 'recover-totp' ? await recoverTotp(apiBaseUrl, username, password, recoveryCode.trim())
        : await startSecurityFlow(apiBaseUrl, securityKind, { currentPassword: password, totpCode });
      if (!isCurrent()) return;
      clearSecrets();
      await loadMaterials(next, isCurrent);
    });
  };
  const submitTotp = () => {
    if (!flow || !validTotp()) return;
    void withOperation(async isCurrent => {
      if (flow.purpose === 'login') {
        await finishLogin(apiBaseUrl, totpCode);
        if (isCurrent()) { clearSecrets(); onClose(); }
      } else {
        const next = await verifyTotp(apiBaseUrl, totpCode);
        await loadMaterials(next, isCurrent);
      }
    });
  };
  const submitPassword = () => {
    const passwordError = passwordValidationError(newPassword);
    if (passwordError) { setError(passwordError); return; }
    if (newPassword !== passwordConfirmation) { setError('两次输入的新密码不一致。'); return; }
    void withOperation(async isCurrent => {
      await completePasswordFlow(apiBaseUrl, newPassword);
      if (isCurrent()) finish(flow, false);
    });
  };
  const confirmCodes = () => {
    if (!savedCodes) { setError('请先保存全部恢复码，并勾选确认。'); return; }
    void withOperation(async isCurrent => {
      await confirmRecoveryCodes(apiBaseUrl);
      if (isCurrent()) finish(flow);
    });
  };
  const downloadCodes = () => {
    if (!codes) return;
    const url = URL.createObjectURL(new Blob([`Damage Viewer 账号恢复码\n每枚仅能使用一次，请离线妥善保存。\n\n${codes.codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'damage-viewer-recovery-codes.txt'; anchor.click();
    URL.revokeObjectURL(url);
  };
  const otpInput = <Form.Item label="验证器动态码" required>
    <Input aria-label="验证器动态码" value={totpCode} onChange={setTotpCode} inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder="6 位动态码" disabled={busy} />
  </Form.Item>;
  const returnToLogin = () => {
    clearSecrets(); setFlow(null); setResult(null); setError(null);
    onEntryChange('login');
  };

  return <Modal title={result?.pending ? '等待开通' : titles[entry]} visible onCancel={onClose} footer={null}
    className="account-dialog" style={{ width: 480, maxWidth: 'calc(100vw - 32px)' }}
    maskClosable={!busy} escToExit={!busy} closable={!busy} focusLock>
    {error ? <Alert type="error" content={error} style={{ marginBottom: 16 }} /> : null}
    {result ? <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Alert type="success" content={result.pending ? '注册凭证已准备完成，账号等待开通。' : '操作已完成，请使用当前密码和验证器重新登录。'} />
      {result.accountId && result.pending ? <Typography.Paragraph>本人账号编号：<Typography.Text code copyable>{result.accountId}</Typography.Text></Typography.Paragraph> : null}
      {result.pending ? <Typography.Paragraph>请保存本人账号编号，完成开通后重新登录。当前仍以访客身份浏览游戏资料。</Typography.Paragraph> : null}
      <Space><Button type="primary" onClick={returnToLogin}>返回登录</Button><Button onClick={onClose}>关闭</Button></Space>
    </Space> : flow ? <>
      <Typography.Paragraph type="secondary">本次操作有效至 {new Date(flow.expiresAt).toLocaleTimeString()}，关闭窗口后可通过“继续未完成的操作”查询进度。</Typography.Paragraph>
      {flow.phase === 'recovery_codes_ready' ? <>
        <Alert type="warning" content="请保存以下全部恢复码。每枚仅能使用一次；确认保存后将不再展示。" />
        {codes ? <>
          <pre className="account-recovery-codes" aria-label="恢复码">{codes.codes.join('\n')}</pre>
          <Button onClick={downloadCodes} disabled={busy}>下载恢复码</Button>
          <div style={{ margin: '16px 0' }}><Checkbox checked={savedCodes} onChange={setSavedCodes} disabled={busy}>我已离线保存全部恢复码</Checkbox></div>
          <Button type="primary" loading={busy} disabled={!savedCodes} onClick={confirmCodes}>确认已保存，完成操作</Button>
        </> : <Typography.Paragraph>恢复码尚未加载，请查询当前进度重试。</Typography.Paragraph>}
      </> : passwordPurpose(flow) ? <Form layout="vertical" onSubmit={submitPassword}>
        <Form.Item label="新密码" required><Input.Password aria-label="新密码" value={newPassword} onChange={setNewPassword} autoComplete="new-password" disabled={busy} maxLength={128} /></Form.Item>
        <Typography.Paragraph type="secondary">{PASSWORD_RULE_HINT} 当前已用 {passwordByteLength(newPassword)}/72 字节。</Typography.Paragraph>
        <Form.Item label="再次输入新密码" required><Input.Password aria-label="再次输入新密码" value={passwordConfirmation} onChange={setPasswordConfirmation} autoComplete="new-password" disabled={busy} maxLength={128} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>保存新密码</Button>
      </Form> : <>
        {bindingPurpose(flow) ? <>
          <Typography.Paragraph>用验证器扫描二维码，再输入生成的动态码。</Typography.Paragraph>
          {setup && /^data:image\/png;base64,/.test(setup.qrCodeDataUrl) ? <img className="account-totp-qr" src={setup.qrCodeDataUrl} alt="验证器绑定二维码" />
            : <Typography.Paragraph>二维码尚未加载，请查询当前进度重试。</Typography.Paragraph>}
        </> : <Typography.Paragraph>密码已验证，请输入验证器中的动态码完成登录。</Typography.Paragraph>}
        <Form layout="vertical" onSubmit={submitTotp}>{otpInput}<Button type="primary" htmlType="submit" loading={busy} disabled={bindingPurpose(flow) && !setup}>验证动态码</Button></Form>
      </>}
      <Button type="text" onClick={() => void refreshFlow()} loading={busy} style={{ marginTop: 16 }}>查询当前进度</Button>
    </> : <Form layout="vertical" onSubmit={submitStart}>
      {entry === 'security' ? <Form.Item label="安全操作"><Select aria-label="安全操作" value={securityKind} onChange={setSecurityKind} disabled={busy} options={[
        { value: 'password', label: '修改密码' }, { value: 'totp', label: '更换验证器' }, { value: 'recovery-codes', label: '重新生成恢复码' }
      ]} /></Form.Item> : <Form.Item label="用户名" required><Input aria-label="用户名" value={username} onChange={setUsername} autoComplete="username" maxLength={32} disabled={busy} /></Form.Item>}
      {entry !== 'recover-password' ? <Form.Item label={entry === 'security' ? '当前密码' : '密码'} required><Input.Password aria-label={entry === 'security' ? '当前密码' : '密码'} value={password} onChange={setPassword}
        autoComplete={entry === 'register' ? 'new-password' : 'current-password'} disabled={busy} maxLength={128} /></Form.Item> : null}
      {entry === 'register' ? <Form.Item label="再次输入密码" required><Input.Password aria-label="再次输入密码" value={passwordConfirmation} onChange={setPasswordConfirmation} autoComplete="new-password" disabled={busy} maxLength={128} /></Form.Item> : null}
      {entry === 'recover-password' || entry === 'security' ? otpInput : null}
      {entry === 'recover-password' || entry === 'recover-totp' ? <Form.Item label="未使用的恢复码" required><Input aria-label="未使用的恢复码" value={recoveryCode} onChange={setRecoveryCode} autoComplete="off" disabled={busy} /></Form.Item> : null}
      {entry === 'register' ? <Typography.Paragraph type="secondary">{PASSWORD_RULE_HINT} 当前已用 {passwordByteLength(password)}/72 字节。注册后须绑定验证器、保存恢复码，再等待开通。</Typography.Paragraph> : null}
      <Button type="primary" htmlType="submit" loading={busy}>{entry === 'register' ? '创建账号并绑定验证器' : entry === 'login' ? '下一步' : '验证并继续'}</Button>
      <div style={{ marginTop: 12 }}><Button type="text" disabled={busy} onClick={() => void refreshFlow()}>继续未完成的操作</Button></div>
      {entry === 'login' ? <Space wrap>
        <Button type="text" disabled={busy} onClick={() => onEntryChange('recover-password')}>忘记密码</Button>
        <Button type="text" disabled={busy} onClick={() => onEntryChange('recover-totp')}>验证器丢失</Button>
        <Button type="text" disabled={busy} onClick={() => onEntryChange('register')}>注册账号</Button>
      </Space> : entry !== 'security' ? <Button type="text" disabled={busy} onClick={() => onEntryChange('login')}>返回登录</Button> : null}
      {entry === 'recover-password' || entry === 'recover-totp' ? <Typography.Paragraph type="secondary">如所需的两项证明都已丢失，无法自助恢复账号。</Typography.Paragraph> : null}
    </Form>}
  </Modal>;
}
