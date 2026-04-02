/** Mock 场地与流水数据（无接口时的占位） */

export const cities = ['青岛', '上海', '北京', '广州', '深圳', '杭州', '成都', '武汉', '西安', '南京'];
export const games = ['英雄联盟', '绝地求生', '永劫无间', '魔兽世界', 'CS2', '无畏契约', '赛博朋克2077', '原神', '命运2'];
export const projectList = ['项目A', '项目B', '项目C', '项目D'];

export const generateTrendData = (points, base, variance, labelType = 'hour') =>
  Array.from({ length: points }, (_, i) => ({
    date: labelType === 'hour' ? `${i}:00` : `03-0${i + 1}`,
    value: Math.max(0, base + (Math.random() * variance - variance / 2)),
  }));

export const generateRooms = (count, avgTime, forceHighSuccess = false) =>
  Array.from({ length: count }, (_, i) => {
    const cityName = cities[Math.floor(Math.random() * cities.length)];
    const roomNumber = 1000 + Math.floor(Math.random() * 9000);
    const successVal = forceHighSuccess
      ? 92 + Math.random() * 7.9
      : Math.random() > 0.7
        ? 82 + Math.random() * 7
        : 92 + Math.random() * 7;

    return {
      id: `room-${Math.random()}`,
      name: `${cityName}-${roomNumber}`,
      time: avgTime * (0.8 + Math.random() * 0.4),
      success: parseFloat(successVal.toFixed(1)),
      timeTrend: generateTrendData(12, avgTime, avgTime * 0.2),
      successTrend: generateTrendData(12, successVal, 5),
    };
  });

export const generateGameDetails = (count, avgTime) =>
  Array.from({ length: count }, (_, i) => {
    const gameName = games[i % games.length];
    const successVal = Math.random() > 0.6 ? 84 + Math.random() * 5 : 94 + Math.random() * 5;
    return {
      id: `game-${Math.random()}`,
      name: gameName,
      time: avgTime * (0.9 + Math.random() * 0.3),
      success: parseFloat(successVal.toFixed(1)),
      failure: parseFloat((100 - successVal).toFixed(1)),
      timeTrend: generateTrendData(12, avgTime, avgTime * 0.2),
      successTrend: generateTrendData(12, successVal, 3),
      failureTrend: generateTrendData(12, 100 - successVal, 3),
    };
  });

export const makeEmptySupplyByProject = (projects) =>
  (projects || []).reduce((acc, p) => {
    acc[p] = {
      project: p,
      projectName: '',
      currentRoutes: null,
      ordersToday: null,
      redundancy: null,
      redundancyRatio: null,
    };
    return acc;
  }, {});
