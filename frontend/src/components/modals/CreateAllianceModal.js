import React, { useState } from 'react';
import { X } from 'lucide-react';
import './CreateAllianceModal.css';

const CreateAllianceModal = ({ isOpen, onClose, onCreate }) => {
    const [name, setName] = useState('');
    const [flag, setFlag] = useState('#7c3aed');
    const [declaration, setDeclaration] = useState('');

    if (!isOpen) return null;

    const handleSubmit = () => {
        if (!name.trim() || !declaration.trim()) {
            return;
        }
        onCreate({ name, flag, declaration });
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
                                onChange={(e) => setFlag(e.target.value)}
                                className="color-picker"
                            />
                            <div className="flag-preview" style={{ backgroundColor: flag }}>
                                <span>预览</span>
                            </div>
                        </div>
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
                        disabled={!name.trim() || !declaration.trim()}
                    >
                        创立熵盟
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreateAllianceModal;
