import { useCallback } from 'react';
import { API_BASE } from '../../runtimeConfig';
import {
  isValidObjectId,
  normalizeObjectId
} from '../../app/appShared';

const useLocationTravel = ({
  userLocation,
  isStoppingTravel,
  nodes,
  parseApiResponse,
  getApiErrorMessage,
  applyTravelStatus,
  setUserLocation,
  setCurrentLocationNodeDetail,
  setIsRefreshingLocationDetail,
  setIsStoppingTravel
}) => {
  const updateUserLocation = useCallback(async (location) => {
    const token = localStorage.getItem('token');
    try {
      console.log('正在更新location:', location);
      const response = await fetch(`${API_BASE}/location`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ location })
      });

      const data = await response.json();

      if (response.ok) {
        console.log('location更新成功:', data.location);
        return data.location;
      }

      console.error('location更新失败:', data);
      window.alert(`设置降临位置失败: ${data.error || '未知错误'}`);
      return null;
    } catch (error) {
      console.error('更新location失败:', error);
      window.alert(`网络错误: ${error.message}`);
      return null;
    }
  }, []);

  const fetchLocationNodeDetail = useCallback(async (locationName, options = {}) => {
    const silent = options?.silent === true;
    const normalizedLocationName = typeof locationName === 'string' ? locationName.trim() : '';
    if (!normalizedLocationName || normalizedLocationName === '任意') {
      setCurrentLocationNodeDetail(null);
      return null;
    }

    if (!silent) {
      setIsRefreshingLocationDetail(true);
    }

    try {
      const response = await fetch(`${API_BASE}/nodes/public/search?query=${encodeURIComponent(normalizedLocationName)}`);
      const parsedSearch = await parseApiResponse(response);
      if (!response.ok || !parsedSearch?.data) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsedSearch, '读取当前位置知识域失败'));
        }
        return null;
      }

      const data = parsedSearch.data;
      const results = Array.isArray(data?.results) ? data.results : [];
      const exactCandidates = results.filter((item) => (
        (typeof item?.domainName === 'string' && item.domainName.trim() === normalizedLocationName)
        || (typeof item?.name === 'string' && item.name.trim() === normalizedLocationName)
      ));
      const exactMatch = exactCandidates.find((item) => isValidObjectId(item?.nodeId || item?._id)) || null;
      const localNodeMatch = (Array.isArray(nodes) ? nodes : []).find((item) => (
        typeof item?.name === 'string'
        && item.name.trim() === normalizedLocationName
        && isValidObjectId(item?._id)
      ));
      const detailNodeId = normalizeObjectId(
        exactMatch?.nodeId
        || exactMatch?._id
        || localNodeMatch?._id
      );
      if (isValidObjectId(detailNodeId)) {
        const detailResponse = await fetch(`${API_BASE}/nodes/public/node-detail/${detailNodeId}?includeFavoriteCount=1`);
        const parsedDetail = await parseApiResponse(detailResponse);
        if (!detailResponse.ok || !parsedDetail?.data?.node) {
          if (!silent) {
            window.alert(getApiErrorMessage(parsedDetail, '读取当前位置知识域详情失败'));
          }
          return null;
        }
        setCurrentLocationNodeDetail(parsedDetail.data.node);
        return parsedDetail.data.node;
      }

      return null;
    } catch (error) {
      console.error('获取位置节点详情失败:', error);
      if (!silent) {
        window.alert(`读取当前位置知识域失败: ${error.message}`);
      }
      return null;
    } finally {
      if (!silent) {
        setIsRefreshingLocationDetail(false);
      }
    }
  }, [
    getApiErrorMessage,
    nodes,
    parseApiResponse,
    setCurrentLocationNodeDetail,
    setIsRefreshingLocationDetail
  ]);

  const syncUserLocation = useCallback((location) => {
    const nextLocation = location || '';
    const prevLocation = userLocation || '';
    if (nextLocation !== prevLocation) {
      setCurrentLocationNodeDetail(null);
    }
    if (!location || location === '任意') {
      setUserLocation(location || '');
      localStorage.setItem('userLocation', location || '');
      return;
    }
    setUserLocation(location);
    localStorage.setItem('userLocation', location);
  }, [setCurrentLocationNodeDetail, setUserLocation, userLocation]);

  const estimateTravelToNode = useCallback(async (targetNodeId) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const response = await fetch(`${API_BASE}/travel/estimate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ targetNodeId })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        return {
          error: getApiErrorMessage(parsed, '获取移动预估失败')
        };
      }
      return data;
    } catch (error) {
      return { error: `获取移动预估失败: ${error.message}` };
    }
  }, [getApiErrorMessage, parseApiResponse]);

  const startTravelToNode = useCallback(async (targetNodeId) => {
    const token = localStorage.getItem('token');
    if (!token) return 'failed';

    try {
      const response = await fetch(`${API_BASE}/travel/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ targetNodeId })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok) {
        window.alert(getApiErrorMessage(parsed, '开始移动失败'));
        return 'failed';
      }

      if (!data) {
        window.alert('开始移动失败：返回数据不是 JSON');
        return 'failed';
      }

      applyTravelStatus(data.travel || { isTraveling: false });
      const currentStoredLocation = localStorage.getItem('userLocation') || '';
      if (typeof data.location === 'string' && data.location !== currentStoredLocation) {
        syncUserLocation(data.location);
      }

      if (data.travel?.isStopping) {
        if (data.message) {
          window.alert(data.message);
        }
        return 'queued';
      }

      return 'started';
    } catch (error) {
      window.alert(`开始移动失败: ${error.message}`);
      return 'failed';
    }
  }, [applyTravelStatus, getApiErrorMessage, parseApiResponse, syncUserLocation]);

  const stopTravel = useCallback(async () => {
    if (isStoppingTravel) return;
    setIsStoppingTravel(true);
    const token = localStorage.getItem('token');

    try {
      const response = await fetch(`${API_BASE}/travel/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok) {
        window.alert(getApiErrorMessage(parsed, '停止移动失败'));
        return;
      }

      if (!data) {
        window.alert('停止移动失败：返回数据不是 JSON');
        return;
      }

      applyTravelStatus(data.travel || { isTraveling: false });
      if (typeof data.location === 'string') {
        syncUserLocation(data.location);
      }
    } catch (error) {
      window.alert(`停止移动失败: ${error.message}`);
    } finally {
      setIsStoppingTravel(false);
    }
  }, [
    applyTravelStatus,
    getApiErrorMessage,
    isStoppingTravel,
    parseApiResponse,
    setIsStoppingTravel,
    syncUserLocation
  ]);

  return {
    updateUserLocation,
    fetchLocationNodeDetail,
    syncUserLocation,
    estimateTravelToNode,
    startTravelToNode,
    stopTravel
  };
};

export default useLocationTravel;
