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
  onCloseMarchModePick,
  onCloseSkillPick
} = {}) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onEscape?.();
        return;
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
  }, [open, onEscape, onTogglePause, onTogglePitch, runtimeRef, spacePressedRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyUp = (event) => {
      if (event.code === 'Space') {
        spacePressedRef.current = false;
      }
    };
    const onBlur = () => {
      spacePressedRef.current = false;
    };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [open, spacePressedRef]);

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
