import React, { useRef } from 'react';
import { Search, Plus, X } from 'lucide-react';
import './Home.css';

const Home = ({
    webglCanvasRef,
    searchQuery,
    onSearchChange,
    onSearchFocus,
    onSearchClear,
    searchResults,
    showSearchResults,
    isSearching,
    onSearchResultClick,
    onCreateNode,
    isAdmin,
    currentLocationNodeDetail
}) => {
    const searchBarRef = useRef(null);

    return (
        <>
            {/* Left Sidebar - Navigation */}
            <div className="navigation-sidebar">
                <div className="nav-item active">
                    <span className="nav-label">首页</span>
                </div>
            </div>

            {/* Main Content */}
            <div className="webgl-scene-container">
                {/* WebGL Canvas */}
                <canvas
                    ref={webglCanvasRef}
                    className="webgl-canvas"
                />

                {/* Search Bar Container */}
                <div className="search-container" ref={searchBarRef}>
                    {/* Floating Search Bar */}
                    <div className="floating-search-bar">
                        <div className="search-and-create-container">
                           <div className="search-input-wrapper" onClick={onSearchFocus}>
                                <Search className="search-icon" size={24} />
                                <input
                                    type="text"
                                    placeholder="搜索节点...（支持多关键词，用空格分隔）"
                                    value={searchQuery}
                                    onChange={onSearchChange}
                                    className="search-input-floating"
                                    onFocus={onSearchFocus}
                                />
                                {searchQuery && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSearchClear();
                                        }}
                                        className="search-clear-btn"
                                    >
                                        <X size={18} />
                                    </button>
                                )}
                            </div>
                            <button
                                onClick={onCreateNode}
                                className="btn btn-success create-node-btn"
                            >
                                <Plus size={18} />
                                创建节点
                            </button>
                        </div>
                    </div>

                    {/* Search Results */}
                    {searchQuery && searchResults.length > 0 && showSearchResults && (
                        <div className="search-results-panel">
                            <div className="search-results-scroll">
                                {searchResults.map((node) => (
                                    <div
                                        key={node._id}
                                        className="search-result-card"
                                        onClick={() => onSearchResultClick(node)}
                                    >
                                        <div className="search-card-title">{node.name}</div>
                                        <div className="search-card-desc">{node.description}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* No Results */}
                    {searchQuery && !isSearching && searchResults.length === 0 && showSearchResults && (
                        <div className="search-no-results">
                            未找到匹配的节点
                        </div>
                    )}

                    {/* Loading */}
                    {isSearching && showSearchResults && (
                        <div className="search-loading-indicator">
                            搜索中...
                        </div>
                    )}
                </div>
            </div>

            {/* Right Sidebar - Location Resident */}
            {!isAdmin ? (
                <div className="location-resident-sidebar">
                    <div className="location-sidebar-header">
                        <h3>当前所在的知识域</h3>
                    </div>

                    {currentLocationNodeDetail ? (
                        <div className="location-sidebar-content">
                            <div className="location-node-title">{currentLocationNodeDetail.name}</div>

                            {currentLocationNodeDetail.description && (
                                <div className="location-node-section">
                                    <div className="section-label">描述</div>
                                    <div className="section-content">{currentLocationNodeDetail.description}</div>
                                </div>
                            )}

                            {currentLocationNodeDetail.relatedParentDomains && currentLocationNodeDetail.relatedParentDomains.length > 0 && (
                                <div className="location-node-section">
                                    <div className="section-label">父域</div>
                                    <div className="section-tags">
                                        {currentLocationNodeDetail.relatedParentDomains.map((parent, idx) => (
                                            <span key={idx} className="node-tag parent-tag">{parent}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {currentLocationNodeDetail.relatedChildDomains && currentLocationNodeDetail.relatedChildDomains.length > 0 && (
                                <div className="location-node-section">
                                    <div className="section-label">子域</div>
                                    <div className="section-tags">
                                        {currentLocationNodeDetail.relatedChildDomains.map((child, idx) => (
                                            <span key={idx} className="node-tag child-tag">{child}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {currentLocationNodeDetail.knowledge && (
                                <div className="location-node-section">
                                    <div className="section-label">知识内容</div>
                                    <div className="section-content knowledge-content">
                                        {currentLocationNodeDetail.knowledge}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="location-sidebar-empty">
                            <p>暂未降临到任何知识域</p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="location-resident-sidebar admin-sidebar">
                    <div className="location-sidebar-header">
                        <h3>管理员视图</h3>
                    </div>
                    <div className="location-sidebar-empty">
                        <p>管理员可查看所有知识域</p>
                    </div>
                </div>
            )}
        </>
    );
};

export default Home;
