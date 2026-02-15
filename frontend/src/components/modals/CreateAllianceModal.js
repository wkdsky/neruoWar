import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import './CreateAllianceModal.css';
import AllianceStylePreview from './AllianceStylePreview';
import {
    ALLIANCE_PATTERN_OPTIONS,
    DEFAULT_ALLIANCE_VISUAL_STYLE,
    normalizeAllianceVisualStyle
} from '../../utils/allianceVisualStyle';

const CreateAllianceModal = ({ isOpen, onClose, onCreate }) => {
    const [name, setName] = useState('');
    const [flag, setFlag] = useState('#7c3aed');
    const [declaration, setDeclaration] = useState('');
    const [styleDraft, setStyleDraft] = useState({
        ...DEFAULT_ALLIANCE_VISUAL_STYLE,
        primaryColor: '#7c3aed'
    });

    useEffect(() => {
        if (!isOpen) return;
        setName('');
        setFlag('#7c3aed');
        setDeclaration('');
        setStyleDraft({
            ...DEFAULT_ALLIANCE_VISUAL_STYLE,
            primaryColor: '#7c3aed'
        });
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = () => {
        const normalizedStyle = normalizeAllianceVisualStyle(styleDraft, '主视觉');
        if (!name.trim() || !declaration.trim() || !normalizedStyle.name) {
            return;
        }
        onCreate({ name, flag, declaration, visualStyle: normalizedStyle });
    };

    const handleContentClick = (e) => {
        e.stopPropagation();
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content create-alliance-modal" onClick={handleContentClick}>
                <div className="modal-header">
                    <h2>创立新熵盟</h2>
                    <button className="modal-close" onClick={onClose}>
                        <X size={24} />
                    </button>
                </div>
                <div className="modal-body">
                    <div className="form-group">
                        <label>熵盟名称 *</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="输入熵盟名称"
                            className="form-input"
                        />
                    </div>
                    <div className="form-group">
                        <label>熵盟旗帜（颜色） *</label>
                        <div className="color-picker-group">
                            <input
                                type="color"
                                value={flag}
                                onChange={(e) => {
                                    const nextColor = e.target.value;
                                    setFlag(nextColor);
                                    setStyleDraft((prev) => ({
                                        ...prev,
                                        primaryColor: nextColor
                                    }));
                                }}
                                className="color-picker"
                            />
                            <div className="flag-preview" style={{ backgroundColor: flag }}>
                                <span>预览</span>
                            </div>
                        </div>
                    </div>
                    <div className="form-group">
                        <label>知识域视觉样式（必填） *</label>
                        <div className="alliance-style-editor-grid">
                            <label className="mini-field">
                                <span>样式名称</span>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={styleDraft.name}
                                    onChange={(e) => setStyleDraft((prev) => ({ ...prev, name: e.target.value }))}
                                    placeholder="例如：曜紫星纹"
                                />
                            </label>
                            <label className="mini-field">
                                <span>底纹类型</span>
                                <select
                                    className="form-input alliance-style-select"
                                    value={styleDraft.patternType}
                                    onChange={(e) => setStyleDraft((prev) => ({ ...prev, patternType: e.target.value }))}
                                >
                                    {ALLIANCE_PATTERN_OPTIONS.map((item) => (
                                        <option key={item.value} value={item.value}>{item.label}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        <div className="alliance-style-color-row">
                            <label className="mini-color-field">
                                <span>主色</span>
                                <input
                                    type="color"
                                    value={styleDraft.primaryColor}
                                    onChange={(e) => setStyleDraft((prev) => ({ ...prev, primaryColor: e.target.value }))}
                                    className="color-picker"
                                />
                            </label>
                            <label className="mini-color-field">
                                <span>辅色</span>
                                <input
                                    type="color"
                                    value={styleDraft.secondaryColor}
                                    onChange={(e) => setStyleDraft((prev) => ({ ...prev, secondaryColor: e.target.value }))}
                                    className="color-picker"
                                />
                            </label>
                            <label className="mini-color-field">
                                <span>发光</span>
                                <input
                                    type="color"
                                    value={styleDraft.glowColor}
                                    onChange={(e) => setStyleDraft((prev) => ({ ...prev, glowColor: e.target.value }))}
                                    className="color-picker"
                                />
                            </label>
                            <label className="mini-color-field">
                                <span>高光边</span>
                                <input
                                    type="color"
                                    value={styleDraft.rimColor}
                                    onChange={(e) => setStyleDraft((prev) => ({ ...prev, rimColor: e.target.value }))}
                                    className="color-picker"
                                />
                            </label>
                            <label className="mini-color-field">
                                <span>字体色</span>
                                <input
                                    type="color"
                                    value={styleDraft.textColor}
                                    onChange={(e) => setStyleDraft((prev) => ({ ...prev, textColor: e.target.value }))}
                                    className="color-picker"
                                />
                            </label>
                        </div>
                        <AllianceStylePreview styleConfig={styleDraft} label="示例" />
                    </div>
                    <div className="form-group">
                        <label>熵盟号召（势力宣言） *</label>
                        <textarea
                            value={declaration}
                            onChange={(e) => setDeclaration(e.target.value)}
                            placeholder="输入熵盟的号召或宣言..."
                            rows="4"
                            className="form-textarea"
                        />
                    </div>
                    <div className="create-alliance-info">
                        <p><strong>注意：</strong></p>
                        <ul>
                            <li>创建熵盟需要至少是一个知识域的域主</li>
                            <li>创建成功后，您将自动成为该熵盟的成员</li>
                            <li>每个用户只能属于一个熵盟</li>
                        </ul>
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>取消</button>
                    <button
                        className="btn btn-primary"
                        onClick={handleSubmit}
                        disabled={!name.trim() || !declaration.trim() || !styleDraft.name.trim()}
                    >
                        创立熵盟
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreateAllianceModal;
