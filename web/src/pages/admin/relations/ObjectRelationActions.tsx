import { Button } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import type { ImageRelationTarget } from '../../../types/imageRelation';
import { ImageUsagesModal } from './ImageUsagesModal';
import { RepresentativeImageModal } from './RepresentativeImageModal';
import { SkillRelationsModal } from './SkillRelationsModal';

type ContextProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDirtyChange: (dirty: boolean) => void;
};

export function ObjectRelationActions({ target, onImageSaved, ...context }: ContextProps & {
  target: ImageRelationTarget;
  onImageSaved?: () => void;
}) {
  const [active, setActive] = useState<'skills' | 'image' | null>(null);
  const { apiBaseUrl, selectedGameId, adminToken, onDirtyChange } = context;
  const skillTarget = target.kind === 'character' || target.kind === 'equipment' || target.kind === 'skill'
    ? { kind: target.kind, key: target.key, name: target.name } : null;
  useEffect(() => { setActive(null); }, [apiBaseUrl, selectedGameId, adminToken, target.kind, target.key, target.skillKey]);
  const close = () => { setActive(null); onDirtyChange(false); };
  const disabled = !selectedGameId || !adminToken.trim() || (target.kind === 'skillEffect' && !target.skillKey);
  return <>
    {skillTarget ? <Button size="mini" disabled={disabled} onClick={() => setActive('skills')}>
      {target.kind === 'skill' ? '挂载对象' : '关联技能'}
    </Button> : null}
    <Button size="mini" disabled={disabled} onClick={() => setActive('image')}>代表图片</Button>
    {active === 'skills' && skillTarget ? <SkillRelationsModal
      {...context} visible target={skillTarget} onClose={close}
    /> : null}
    {active === 'image' ? <RepresentativeImageModal
      {...context} visible target={target} onClose={close} onSaved={onImageSaved}
    /> : null}
  </>;
}

export function ImageUsageAction({ imageKey, ...context }: ContextProps & { imageKey: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setVisible(false); }, [context.apiBaseUrl, context.selectedGameId, context.adminToken, imageKey]);
  return <>
    <Button size="mini" disabled={!context.selectedGameId || !context.adminToken.trim()}
      onClick={() => setVisible(true)}>用途关系</Button>
    {visible ? <ImageUsagesModal {...context} visible imageKey={imageKey}
      onClose={() => { setVisible(false); context.onDirtyChange(false); }} /> : null}
  </>;
}
