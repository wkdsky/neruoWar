import { useCallback, useState } from 'react';
import { API_BASE } from '../../../../../runtimeConfig';

const useAdminSettingsFeature = () => {
    const [travelUnitSeconds, setTravelUnitSeconds] = useState(60);
    const [travelUnitInput, setTravelUnitInput] = useState('60');
    const [distributionAnnouncementLeadHours, setDistributionAnnouncementLeadHours] = useState(24);
    const [distributionLeadInput, setDistributionLeadInput] = useState('24');
    const [starMapNodeLimit, setStarMapNodeLimit] = useState(50);
    const [starMapNodeLimitInput, setStarMapNodeLimitInput] = useState('50');

    const fetchAdminSettings = useCallback(async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE}/admin/settings`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                const seconds = String(data?.settings?.travelUnitSeconds ?? 60);
                const leadHours = String(data?.settings?.distributionAnnouncementLeadHours ?? 24);
                const starMapLimit = String(data?.settings?.starMapNodeLimit ?? 50);
                setTravelUnitSeconds(parseInt(seconds, 10));
                setTravelUnitInput(seconds);
                setDistributionAnnouncementLeadHours(parseInt(leadHours, 10));
                setDistributionLeadInput(leadHours);
                setStarMapNodeLimit(parseInt(starMapLimit, 10));
                setStarMapNodeLimitInput(starMapLimit);
            }
        } catch (error) {
            console.error('获取系统设置失败:', error);
        }
    }, []);

    const saveAdminSettings = useCallback(async () => {
        const token = localStorage.getItem('token');
        const parsed = parseInt(travelUnitInput, 10);
        const parsedLeadHours = parseInt(distributionLeadInput, 10);
        const parsedStarMapNodeLimit = parseInt(starMapNodeLimitInput, 10);

        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 86400) {
            alert('每单位移动耗时必须是 1-86400 的整数秒');
            return;
        }
        if (!Number.isInteger(parsedLeadHours) || parsedLeadHours < 1 || parsedLeadHours > 168) {
            alert('分发公告提前时长必须是 1-168 的整数小时');
            return;
        }
        if (!Number.isInteger(parsedStarMapNodeLimit) || parsedStarMapNodeLimit < 10 || parsedStarMapNodeLimit > 200) {
            alert('星盘节点上限必须是 10-200 的整数');
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/admin/settings`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    travelUnitSeconds: parsed,
                    distributionAnnouncementLeadHours: parsedLeadHours,
                    starMapNodeLimit: parsedStarMapNodeLimit
                })
            });
            if (response.ok) {
                const data = await response.json();
                const seconds = parseInt(String(data?.settings?.travelUnitSeconds ?? parsed), 10);
                const leadHours = parseInt(String(data?.settings?.distributionAnnouncementLeadHours ?? parsedLeadHours), 10);
                const nextStarMapLimit = parseInt(String(data?.settings?.starMapNodeLimit ?? parsedStarMapNodeLimit), 10);
                setTravelUnitSeconds(seconds);
                setTravelUnitInput(String(seconds));
                setDistributionAnnouncementLeadHours(leadHours);
                setDistributionLeadInput(String(leadHours));
                setStarMapNodeLimit(nextStarMapLimit);
                setStarMapNodeLimitInput(String(nextStarMapLimit));
                alert('系统设置已保存');
            } else {
                const data = await response.json();
                alert(data.error || '保存失败');
            }
        } catch (error) {
            console.error('保存系统设置失败:', error);
            alert('保存失败');
        }
    }, [distributionLeadInput, starMapNodeLimitInput, travelUnitInput]);

    return {
        travelUnitInput,
        distributionLeadInput,
        starMapNodeLimitInput,
        travelUnitSeconds,
        distributionAnnouncementLeadHours,
        starMapNodeLimit,
        setTravelUnitInput,
        setDistributionLeadInput,
        setStarMapNodeLimitInput,
        fetchAdminSettings,
        saveAdminSettings
    };
};

export default useAdminSettingsFeature;
