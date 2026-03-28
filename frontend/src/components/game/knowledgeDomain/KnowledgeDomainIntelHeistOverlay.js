import React from 'react';
import {
  formatElapsedMinutesText,
  getNodeDisplayName
} from './shared';

const KnowledgeDomainIntelHeistOverlay = ({
  isIntelHeistMode,
  isIntelHeistExitConfirmOpen,
  setIsIntelHeistExitConfirmOpen,
  cancelExitIntelHeistGame,
  exitIntelHeistGame,
  intelHeistState,
  node
}) => {
  if (!isIntelHeistMode) return null;

  return (
    <>
      {isIntelHeistExitConfirmOpen && (
        <div
          className="intel-heist-exit-confirm-overlay"
          onClick={() => setIsIntelHeistExitConfirmOpen(false)}
        >
          <div
            className="intel-heist-exit-confirm-card"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>提前结束情报窃取？</h3>
            <p>结束后将返回知识域主视角，本次未完成搜索不会保留。</p>
            <div className="intel-heist-exit-confirm-actions">
              <button
                type="button"
                className="btn btn-small btn-secondary"
                onClick={cancelExitIntelHeistGame}
              >
                继续窃取
              </button>
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={() => {
                  setIsIntelHeistExitConfirmOpen(false);
                  exitIntelHeistGame();
                }}
              >
                确认结束
              </button>
            </div>
          </div>
        </div>
      )}
      {intelHeistState.timeoutTriggered && !intelHeistState.resultOpen && (
        <div className="intel-heist-timeout-overlay">
          <div className="intel-heist-timeout-card">
            <h3>窃取行动失败</h3>
            <p>时间耗尽，未获得情报文件。</p>
            <div className="intel-heist-timeout-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={() => exitIntelHeistGame()}>
                返回知识域主视角
              </button>
            </div>
          </div>
        </div>
      )}
      <div className={`intel-heist-hint ${intelHeistState.hintVisible && intelHeistState.hintText ? 'visible' : ''}`}>
        {intelHeistState.hintText || ''}
      </div>
      {intelHeistState.resultOpen && intelHeistState.resultSnapshot && (
        <div className="intel-heist-result-overlay">
          <div className="intel-heist-result-card">
            <h3>{`已找到 ${getNodeDisplayName(node) || '该知识域'} 的情报文件`}</h3>
            <p>{`布防情报：${formatElapsedMinutesText(intelHeistState.resultSnapshot.deploymentUpdatedAt)}执行的部署`}</p>
            <div className="intel-heist-result-gates">
              <div className="intel-heist-result-gate">
                <strong>承口</strong>
                {(intelHeistState.resultSnapshot?.gateDefense?.cheng || []).length > 0 ? (
                  (intelHeistState.resultSnapshot.gateDefense.cheng || []).map((entry) => (
                    <span key={`intel-result-cheng-${entry.unitTypeId}`}>
                      {`${entry.unitName || entry.unitTypeId} x ${entry.count}`}
                    </span>
                  ))
                ) : (
                  <span>暂无驻防</span>
                )}
              </div>
              <div className="intel-heist-result-gate">
                <strong>启口</strong>
                {(intelHeistState.resultSnapshot?.gateDefense?.qi || []).length > 0 ? (
                  (intelHeistState.resultSnapshot.gateDefense.qi || []).map((entry) => (
                    <span key={`intel-result-qi-${entry.unitTypeId}`}>
                      {`${entry.unitName || entry.unitTypeId} x ${entry.count}`}
                    </span>
                  ))
                ) : (
                  <span>暂无驻防</span>
                )}
              </div>
            </div>
            <div className="intel-heist-result-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={() => exitIntelHeistGame()}>
                返回知识域主视角
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default KnowledgeDomainIntelHeistOverlay;
