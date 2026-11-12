import { useState } from 'react';
import { Alert, Button, Input, Modal, Space, Typography } from '@arco-design/web-react';
import { buildProblemReport, issueRepository, problemIssueUrl } from '../services/problemReport';
import { getErrorMessage } from '../services/apiClient';

export function ProblemReport({ gameId, mode, material }: { gameId: string | null; mode: string; material: unknown }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const repository = issueRepository(import.meta.env.VITE_FEEDBACK_REPOSITORY);
  const report = () => buildProblemReport({ gameId, mode, material, description });
  const download = () => {
    try {
      const content = JSON.stringify(report(), null, 2);
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'damage-problem-report.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0); setError(null); setNotice('复现材料已下载。');
    } catch (cause) { setError(getErrorMessage(cause)); }
  };
  const copy = async () => {
    try {
      const current = report();
      await navigator.clipboard.writeText(`预期表现：\n\n实际表现：\n\n${current.description}\n\n游戏：${current.gameId ?? '未选择'}\n发布：${current.release}\n资料版本：${current.gameVersion}\n引擎：${current.wasm.sha256}\n适配器：${current.adapterVersion}\n请附上复现材料。`);
      setError(null); setNotice('问题说明已复制。');
    } catch { setError('无法访问剪贴板，请下载复现材料并手动填写问题说明。'); }
  };
  return <>
    <Button onClick={() => setOpen(true)}>报告问题</Button>
    <Modal title="报告计算或资料问题" visible={open} onCancel={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>关闭</Button>}>
      <Typography.Paragraph>说明预期与实际表现，并补充游戏版本、图片或视频。复现材料会附当前场景、结果和配置身份，不含登录或计算凭据。</Typography.Paragraph>
      <Input.TextArea aria-label="问题说明" value={description} onChange={setDescription} placeholder="预期是什么，实际是什么；怎样复现？" autoSize={{ minRows: 4, maxRows: 10 }} />
      <Space wrap style={{ marginTop: 16 }}>
        <Button onClick={() => { void copy(); }}>复制问题说明</Button>
        <Button onClick={download}>下载复现材料</Button>
        {repository && open ? <Button href={problemIssueUrl(repository, report())} target="_blank" rel="noopener noreferrer" type="primary">前往 GitHub 提交问题</Button> : null}
      </Space>
      {!repository ? <Typography.Paragraph type="secondary">尚未配置有效的反馈仓库，可下载材料或复制说明后交给维护者。</Typography.Paragraph> : null}
      <Typography.Paragraph type="secondary">图片、视频和复现文件请作为附件上传；提交前检查材料中自行填写的内容。</Typography.Paragraph>
      {error ? <Alert type="error" content={error} /> : notice ? <Alert type="success" content={notice} /> : null}
    </Modal>
  </>;
}
