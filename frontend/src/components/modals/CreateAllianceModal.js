import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import './CreateAllianceModal.css';
import AllianceStylePreview from './AllianceStylePreview';
import {
    ALLIANCE_PATTERN_OPTIONS,
    DEFAULT_ALLIANCE_VISUAL_STYLE,
    normalizeAllianceVisualStyle
} from '../../utils/allianceVisualStyle';

const DEFAULT_STYLE_NAME = '主视觉';

const renderInlineHint = (hint) => (
    <div
        className={`create-alliance-inline-hint-slot${hint ? ` create-alliance-inline-hint-slot--${hint.tone}` : ''}`}
        aria-live="polite"
    >
        {hint ? hint.message : '\u00A0'}
    </div>
);

const normalizeNameKey = (value = '') => String(value || '').trim().toLowerCase();

const clampColorChannel = (value) => Math.max(0, Math.min(255, Math.round(value)));

const hslToHex = (hue, saturation, lightness) => {
    const normalizedHue = ((Number(hue) % 360) + 360) % 360;
    const normalizedSaturation = Math.max(0, Math.min(100, Number(saturation))) / 100;
    const normalizedLightness = Math.max(0, Math.min(100, Number(lightness))) / 100;
    const chroma = (1 - Math.abs((2 * normalizedLightness) - 1)) * normalizedSaturation;
    const hueSegment = normalizedHue / 60;
    const x = chroma * (1 - Math.abs((hueSegment % 2) - 1));

    let red = 0;
    let green = 0;
    let blue = 0;

    if (hueSegment >= 0 && hueSegment < 1) {
        red = chroma;
        green = x;
    } else if (hueSegment < 2) {
        red = x;
        green = chroma;
    } else if (hueSegment < 3) {
        green = chroma;
        blue = x;
    } else if (hueSegment < 4) {
        green = x;
        blue = chroma;
    } else if (hueSegment < 5) {
        red = x;
        blue = chroma;
    } else {
        red = chroma;
        blue = x;
    }

    const match = normalizedLightness - (chroma / 2);
    const toHex = (channel) => clampColorChannel((channel + match) * 255).toString(16).padStart(2, '0');
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
};

const createRandomAllianceVisualStyle = () => {
    const baseHue = Math.floor(Math.random() * 360);
    const accentHue = (baseHue + 28 + Math.floor(Math.random() * 56)) % 360;
    const glowHue = (baseHue + 180 + Math.floor(Math.random() * 50)) % 360;
    const patternIndex = Math.floor(Math.random() * ALLIANCE_PATTERN_OPTIONS.length);

    return {
        name: '随机风格',
        primaryColor: hslToHex(baseHue, 68, 52),
        secondaryColor: hslToHex(accentHue, 50, 24),
        glowColor: hslToHex(glowHue, 84, 68),
        rimColor: hslToHex((baseHue + 12) % 360, 78, 82),
        textColor: '#ffffff',
        patternType: ALLIANCE_PATTERN_OPTIONS[patternIndex]?.value || DEFAULT_ALLIANCE_VISUAL_STYLE.patternType
    };
};

const getAllianceNameHint = (rawValue, existingAllianceNameSet) => {
    const value = String(rawValue || '').trim();
    if (!value) {
        return { tone: 'error', message: '请输入熵盟名称' };
    }
    if (value.length < 2) {
        return { tone: 'error', message: '熵盟名称至少2个字符' };
    }
    if (existingAllianceNameSet.has(normalizeNameKey(value))) {
        return { tone: 'error', message: '熵盟名称已存在' };
    }
    return { tone: 'success', message: '熵盟名称可用' };
};

const getDeclarationHint = (rawValue) => {
    const value = String(rawValue || '').trim();
    if (!value) {
        return { tone: 'error', message: '请输入熵盟号召' };
    }
    if (value.length < 6) {
        return { tone: 'error', message: '熵盟号召至少6个字符' };
    }
    return { tone: 'success', message: '熵盟号召格式可用' };
};

const CreateAllianceModal = ({ isOpen, onClose, onCreate, existingAllianceNames = [] }) => {
    const [name, setName] = useState('');
    const [flag, setFlag] = useState('#7c3aed');
    const [declaration, setDeclaration] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formHint, setFormHint] = useState(null);
    const [nameTouched, setNameTouched] = useState(false);
    const [declarationTouched, setDeclarationTouched] = useState(false);
    const [styleDraft, setStyleDraft] = useState({
        ...DEFAULT_ALLIANCE_VISUAL_STYLE,
        primaryColor: '#7c3aed'
    });

    const existingAllianceNameSet = useMemo(() => (
        new Set(existingAllianceNames.map((item) => normalizeNameKey(item)).filter(Boolean))
    ), [existingAllianceNames]);

    const trimmedName = name.trim();
    const trimmedDeclaration = declaration.trim();

    const nameHint = useMemo(() => (
        nameTouched ? getAllianceNameHint(name, existingAllianceNameSet) : null
    ), [existingAllianceNameSet, name, nameTouched]);

    const declarationHint = useMemo(() => (
        declarationTouched ? getDeclarationHint(declaration) : null
    ), [declaration, declarationTouched]);

    useEffect(() => {
        if (!isOpen) return;
        setName('');
        setFlag('#7c3aed');
        setDeclaration('');
        setIsSubmitting(false);
        setFormHint(null);
        setNameTouched(false);
        setDeclarationTouched(false);
        setStyleDraft({
            ...DEFAULT_ALLIANCE_VISUAL_STYLE,
            primaryColor: '#7c3aed'
        });
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        setNameTouched(true);
        setDeclarationTouched(true);
        setFormHint(null);

        const nextNameHint = getAllianceNameHint(name, existingAllianceNameSet);
        const nextDeclarationHint = getDeclarationHint(declaration);
        const normalizedStyle = normalizeAllianceVisualStyle(styleDraft, DEFAULT_STYLE_NAME);

        if (nextNameHint.tone === 'error' || nextDeclarationHint.tone === 'error') {
            return;
        }

        setIsSubmitting(true);
        const result = await onCreate({
            name: trimmedName,
            flag,
            declaration: trimmedDeclaration,
            visualStyle: normalizedStyle
        });
        setIsSubmitting(false);

        if (result?.ok) {
            return;
        }

        if (result?.error === '熵盟名称已存在') {
            setNameTouched(true);
            setFormHint({ tone: 'error', message: '熵盟名称已存在' });
            return;
        }

        if (result?.error === '创建熵盟需要至少是一个知识域的域主') {
            setFormHint({ tone: 'error', message: '当前账号还不是任何知识域的域主，暂时不能创建熵盟' });
            return;
        }

        if (result?.error === '您已经属于一个熵盟，无法创建新熵盟') {
            setFormHint({ tone: 'error', message: '你已经加入熵盟，不能重复创建' });
            return;
        }

        if (result?.error === '管理员不能创建和加入熵盟') {
            setFormHint({ tone: 'error', message: '管理员账号不能创建熵盟' });
            return;
        }

        if (result?.error) {
            setFormHint({ tone: 'error', message: result.error });
        }
    };

    const handleRandomizeStyle = () => {
        const nextStyle = createRandomAllianceVisualStyle();
        setFlag(nextStyle.primaryColor);
        setStyleDraft(nextStyle);
        setFormHint(null);
    };

    const handleContentClick = (event) => {
        event.stopPropagation();
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
                            onChange={(event) => {
                                setName(event.target.value);
                                setFormHint(null);
                            }}
                            onBlur={() => setNameTouched(true)}
                            placeholder="输入熵盟名称"
                            className="form-input"
                        />
                        {renderInlineHint(nameHint)}
                    </div>
                    <div className="form-group">
                        <label>熵盟旗帜（颜色） *</label>
                        <div className="color-picker-group">
                            <input
                                type="color"
                                value={flag}
                                onChange={(event) => {
                                    const nextColor = event.target.value;
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
                        <div className="create-alliance-style-header">
                            <label>所属知识域统一样式</label>
                            <button
                                type="button"
                                className="btn btn-small btn-secondary create-alliance-random-btn"
                                onClick={handleRandomizeStyle}
                            >
                                随机生成样式
                            </button>
                        </div>
                        <div className="alliance-style-editor-grid">
                            <label className="mini-field">
                                <span>样式名称</span>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={styleDraft.name}
                                    onChange={(event) => {
                                        setStyleDraft((prev) => ({ ...prev, name: event.target.value }));
                                        setFormHint(null);
                                    }}
                                    placeholder="留空则使用系统默认名称"
                                />
                            </label>
                            <label className="mini-field">
                                <span>底纹类型</span>
                                <select
                                    className="form-input alliance-style-select"
                                    value={styleDraft.patternType}
                                    onChange={(event) => setStyleDraft((prev) => ({ ...prev, patternType: event.target.value }))}
                                >
                                    {ALLIANCE_PATTERN_OPTIONS.map((item) => (
                                        <option key={item.value} value={item.value}>{item.label}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        {renderInlineHint({
                            tone: 'muted',
                            message: '这项现在是可选的。你可以直接使用系统默认样式，或者点右侧按钮随机生成一套。'
                        })}
                        <div className="alliance-style-color-row">
                            <label className="mini-color-field">
                                <span>主色</span>
                                <input
                                    type="color"
                                    value={styleDraft.primaryColor}
                                    onChange={(event) => setStyleDraft((prev) => ({ ...prev, primaryColor: event.target.value }))}
                                    className="color-picker"
                                />
                            </label>
                            <label className="mini-color-field">
                                <span>辅色</span>
                                <input
                                    type="color"
                                    value={styleDraft.secondaryColor}
                                    onChange={(event) => setStyleDraft((prev) => ({ ...prev, secondaryColor: event.target.value }))}
                                    className="color-picker"
                                />
                            </label>
                            <label className="mini-color-field">
                                <span>发光</span>
                                <input
                                    type="color"
                                    value={styleDraft.glowColor}
                                    onChange={(event) => setStyleDraft((prev) => ({ ...prev, glowColor: event.target.value }))}
                                    className="color-picker"
                                />
                            </label>
                            <label className="mini-color-field">
                                <span>高光边</span>
                                <input
                                    type="color"
                                    value={styleDraft.rimColor}
                                    onChange={(event) => setStyleDraft((prev) => ({ ...prev, rimColor: event.target.value }))}
                                    className="color-picker"
                                />
                            </label>
                            <label className="mini-color-field">
                                <span>字体色</span>
                                <input
                                    type="color"
                                    value={styleDraft.textColor}
                                    onChange={(event) => setStyleDraft((prev) => ({ ...prev, textColor: event.target.value }))}
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
                            onChange={(event) => {
                                setDeclaration(event.target.value);
                                setFormHint(null);
                            }}
                            onBlur={() => setDeclarationTouched(true)}
                            placeholder="输入熵盟的号召或宣言..."
                            rows="4"
                            className="form-textarea"
                        />
                        {renderInlineHint(declarationHint)}
                    </div>
                    <div className="create-alliance-info">
                        <p><strong>注意：</strong></p>
                        <ul>
                            <li>创建熵盟需要至少是一个知识域的域主</li>
                            <li>创建成功后，您将自动成为该熵盟的成员</li>
                            <li>每个用户只能属于一个熵盟</li>
                        </ul>
                    </div>
                    {renderInlineHint(formHint)}
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>取消</button>
                    <button
                        className="btn btn-primary"
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? '创立中...' : '创立熵盟'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreateAllianceModal;
