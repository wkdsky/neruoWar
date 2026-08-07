import { useEffect } from 'react';

const useBattleSceneGlobalInput = ({
  open = false,
  runtimeRef,
  spacePressedRef,
  marchModePickOpen = false,
  isSkillPickMode = false,
  onEscape,
  onTogglePause,
  onTogglePitch,
  onMapKeyCommand,
  onFormationKey,
  onSkillHotkey,
  onCloseMarchModePick,
  onCloseSkillPick
} = {}) => {
  useEffect(() => {
    if (!open) return undefined;
    const keyToCommand = (event) => {
      const key = String(event.key || '').toLowerCase();
      if (key === 'w') return 'forward';
      if (key === 's') return 'backward';
      if (key === 'a') return 'left';
      if (key === 'd') return 'right';
      if (key === 'q') return 'rotate_ccw';
      if (key === 'e') return 'rotate_cw';
      return '';
    };
    const isEditableKeyboardTarget = (target = null) => {
      const tagName = target?.tagName?.toLowerCase();
      return tagName === 'input'
        || tagName === 'textarea'
        || tagName === 'select'
        || target?.isContentEditable;
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onEscape?.();
        return;
      }
      if (!isEditableKeyboardTarget(event.target)) {
        const command = keyToCommand(event);
        if (command) {
          event.preventDefault();
          onMapKeyCommand?.(command, true);
          return;
        }
        if (String(event.key || '').toLowerCase() === 'z' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          onFormationKey?.();
          return;
        }
        if (
          runtimeRef.current?.getPhase?.() === 'battle'
          && !event.ctrlKey
          && !event.metaKey
          && !event.altKey
          && ['1', '2', '3'].includes(String(event.key || ''))
        ) {
          event.preventDefault();
          onSkillHotkey?.(Math.max(0, Number(event.key) - 1));
          return;
        }
      }
      if (event.code === 'Space') {
        event.preventDefault();
        if (runtimeRef.current?.getPhase() === 'deploy') {
          spacePressedRef.current = true;
          return;
        }
        if (runtimeRef.current?.getPhase() === 'battle') {
          onTogglePause?.();
        }
      }
      if (event.key.toLowerCase() === 'v') {
        onTogglePitch?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onEscape, onFormationKey, onMapKeyCommand, onSkillHotkey, onTogglePause, onTogglePitch, runtimeRef, spacePressedRef]);

  useEffect(() => {
    if (!open) return undefined;
    const keyToCommand = (event) => {
      const key = String(event.key || '').toLowerCase();
      if (key === 'w') return 'forward';
      if (key === 's') return 'backward';
      if (key === 'a') return 'left';
      if (key === 'd') return 'right';
      if (key === 'q') return 'rotate_ccw';
      if (key === 'e') return 'rotate_cw';
      return '';
    };
    const onKeyUp = (event) => {
      if (event.code === 'Space') {
        spacePressedRef.current = false;
      }
      const command = keyToCommand(event);
      if (command) onMapKeyCommand?.(command, false);
    };
    const onBlur = () => {
      spacePressedRef.current = false;
      onMapKeyCommand?.('', false, { clearAll: true });
    };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [onMapKeyCommand, open, spacePressedRef]);

  useEffect(() => {
    if (!open || !marchModePickOpen) return undefined;
    const handleGlobalPointerDown = (event) => {
      const target = event.target;
      if (target && typeof target.closest === 'function' && target.closest('.pve2-march-float')) {
        return;
      }
      onCloseMarchModePick?.();
    };
    window.addEventListener('pointerdown', handleGlobalPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
    };
  }, [open, marchModePickOpen, onCloseMarchModePick]);

  useEffect(() => {
    if (!open || !isSkillPickMode) return undefined;
    const handleGlobalPointerDown = (event) => {
      const target = event.target;
      if (target && typeof target.closest === 'function' && target.closest('.pve2-skill-float, .pve2-battle-action-btn.skills')) {
        return;
      }
      onCloseSkillPick?.();
    };
    window.addEventListener('pointerdown', handleGlobalPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
    };
  }, [open, isSkillPickMode, onCloseSkillPick]);
};

export default useBattleSceneGlobalInput;
